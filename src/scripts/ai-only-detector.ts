import { PrismaClient } from "@prisma/client";
import { createCalendarApiService } from "../../src/services/calendar-api";
import { tokenRefreshService } from "../../src/utils/token-refresh";
import { isAiEvent } from "../../src/utils/logger";

const prisma = new PrismaClient({
	log: ["error"], // Only log errors, not queries
});

async function aiOnlyDetectEvents() {
	try {
		// Get ALL users (not just first one)
		const users = await prisma.user.findMany();
		if (users.length === 0) {
			console.error("❌ No users found");
			return;
		}

		let totalAiEventsFound = 0;
		let totalAiEventsStored = 0;
		let totalEventsProcessed = 0;

		// Process each user
		for (const user of users) {
			// Get access token
			const accessToken =
				await tokenRefreshService.validateAndRefreshToken(user.id);
			const calendarService = createCalendarApiService(accessToken);

			// Get all calendars
			const calendars =
				await calendarService.calendar.calendarList.list();
			const allEvents: any[] = [];

			// Fetch events from ALL calendars (not just primary)
			for (const cal of calendars.data.items || []) {
				if (cal.accessRole === "reader") {
					continue;
				}

				const events = await calendarService.getAllEvents(
					cal.id!,
					7,
					7
				);

				// Add calendar info to each event
				events.forEach((event) => {
					event.calendarId = cal.id;
					event.calendarName = cal.summary || cal.id;
				});

				allEvents.push(...events);
			}

			// Process each event for this user
			let aiEventsFound = 0;
			let aiEventsStored = 0;
			let userEventsProcessed = 0;

			for (const googleEvent of allEvents) {
				try {
					userEventsProcessed++;

					// Transform event data
					const eventData =
						calendarService.transformGoogleEventToCalendarEventData(
							googleEvent,
							user.id,
							googleEvent.calendarId || "primary"
						);

					// Check if this is an AI event using our improved detection
					const isAi = isAiEvent(
						eventData.description,
						eventData.title
					);

					if (isAi) {
						aiEventsFound++;

						// Check if event already exists
						const existingEvent =
							await prisma.calendarEvent.findUnique({
								where: {
									googleEventId: eventData.googleEventId,
								},
							});

						// Only process NEW events (not previously detected)
						if (!existingEvent) {
							// Store the event
							await prisma.calendarEvent.upsert({
								where: {
									googleEventId: eventData.googleEventId,
								},
								update: {
									title: eventData.title,
									description: eventData.description,
									startTime: eventData.startTime,
									endTime: eventData.endTime,
									location: eventData.location,
									attendees: eventData.attendees,
									isAiEvent: true,
								},
								create: {
									googleEventId: eventData.googleEventId,
									userId: user.id,
									calendarId: eventData.calendarId,
									title: eventData.title,
									description: eventData.description,
									startTime: eventData.startTime,
									endTime: eventData.endTime,
									location: eventData.location,
									attendees: eventData.attendees,
									isAiEvent: true,
								},
							});

							// Parse and show the command
							const eventText = `${eventData.title} ${
								eventData.description || ""
							}`.trim();

							const aiResult =
								await calendarService.processAiEvent(
									eventText,
									user.id,
									eventData.googleEventId,
									eventData.startTime
								);

							if (aiResult.success && aiResult.parsedCommand) {
								const parsedCommand = aiResult.parsedCommand;

								// Update the stored event with parsed command data
								await prisma.calendarEvent.update({
									where: {
										googleEventId: eventData.googleEventId,
									},
									data: {
										parsedIntent: parsedCommand.intent.type,
										parsedAction: parsedCommand.action.type,
										parsedAmount:
											parsedCommand.parameters.amount ||
											null,
										parsedRecipient:
											parsedCommand.parameters
												.recipient || null,
										parsedFromToken:
											parsedCommand.parameters
												.fromToken || null,
										parsedToToken:
											parsedCommand.parameters.toToken ||
											null,
										parsedProtocol:
											parsedCommand.parameters.protocol ||
											null,
										parsedChain:
											parsedCommand.parameters.chain ||
											null,
										parsedParticipants:
											parsedCommand.parameters
												.participants || null,
										parsedPool:
											parsedCommand.parameters.pool ||
											null,
										parsedPlatform:
											parsedCommand.parameters.platform ||
											null,
										parsedConfidence:
											parsedCommand.confidence,
										parsedScheduledTime:
											parsedCommand.scheduledTime || null,
										parsedCommandRaw: parsedCommand,
									},
								});

								// Clean up parameters by removing undefined values
								const cleanParams = Object.fromEntries(
									Object.entries(
										parsedCommand.parameters
									).filter(
										([_, value]) =>
											value !== undefined &&
											value !== null
									)
								);

								console.log("🤖 Parsed:", {
									command: eventText,
									intent: parsedCommand.intent.type,
									action: parsedCommand.action.type,
									parameters: cleanParams,
									confidence:
										Math.round(
											parsedCommand.confidence * 100
										) + "%",
									scheduledTime:
										parsedCommand.scheduledTime?.toISOString(),
								});

								// Auto-trigger Flow scheduling for Flow transactions
								console.info(
									"DEBUG: Checking Flow scheduling",
									{
										chain: parsedCommand.parameters.chain,
										action: parsedCommand.action.type,
										eventId: eventData.googleEventId,
										isFlow:
											parsedCommand.parameters.chain ===
												"Flow" ||
											parsedCommand.parameters.chain ===
												"Flow EVM" ||
											parsedCommand.parameters.chain ===
												"Flow Cadence",
									}
								);

								if (
									parsedCommand.parameters.chain === "Flow" ||
									parsedCommand.parameters.chain ===
										"Flow EVM" ||
									parsedCommand.parameters.chain ===
										"Flow Cadence"
								) {
									console.info(
										"Auto-triggering Flow scheduling for Flow transaction",
										{
											eventId: eventData.googleEventId,
											chain: parsedCommand.parameters
												.chain,
											action: parsedCommand.action.type,
										}
									);

									// Trigger Flow scheduling automatically
									try {
										const { createFlowSchedulerService } =
											await import(
												"../services/flow-scheduler"
											);
										const flowSchedulerService =
											createFlowSchedulerService();
										const amount =
											parsedCommand.parameters.amount
												?.value ||
											parsedCommand.parameters.amount;
										const recipient =
											parsedCommand.parameters.recipient
												?.address ||
											parsedCommand.parameters.recipient;

										if (amount && recipient) {
											// Calculate delay from scheduled time
											const scheduledTime =
												parsedCommand.scheduledTime ||
												eventData.startTime;
											const delaySeconds = Math.max(
												0,
												Math.floor(
													(scheduledTime.getTime() -
														Date.now()) /
														1000
												)
											);

											console.info(
												"Auto-scheduling Flow transaction",
												{
													eventId:
														eventData.googleEventId,
													recipient,
													amount: amount.toString(),
													delaySeconds,
													scheduledTime:
														scheduledTime.toISOString(),
												}
											);

											const flowResult =
												await flowSchedulerService.schedulePaymentViaEVM(
													{
														recipient,
														amount: amount.toString(),
														delaySeconds,
														userId: user.id,
													}
												);

											if (flowResult.success) {
												// Update the calendar event with Flow scheduling info
												await prisma.calendarEvent.update(
													{
														where: {
															googleEventId:
																eventData.googleEventId,
														},
														data: {
															flowScheduleId:
																flowResult.scheduleId,
															flowEvmTxHash:
																flowResult.evmTxHash,
															flowCadenceTxId:
																flowResult.cadenceTxId,
														},
													}
												);

												console.info(
													"Flow transaction auto-scheduled successfully",
													{
														eventId:
															eventData.googleEventId,
														scheduleId:
															flowResult.scheduleId,
														evmTxHash:
															flowResult.evmTxHash,
													}
												);
											} else {
												console.warn(
													"Failed to auto-schedule Flow transaction",
													{
														eventId:
															eventData.googleEventId,
														error: flowResult.error,
													}
												);
											}
										}
									} catch (flowError) {
										console.error(
											"Error auto-scheduling Flow transaction",
											{
												flowError,
												eventId:
													eventData.googleEventId,
											}
										);
									}
								}
							}
						}

						aiEventsStored++;
					} else {
						// For non-AI events, check if they exist in DB and remove them
						const existingEvent =
							await prisma.calendarEvent.findUnique({
								where: {
									googleEventId: eventData.googleEventId,
								},
							});

						if (existingEvent) {
							await prisma.calendarEvent.delete({
								where: {
									googleEventId: eventData.googleEventId,
								},
							});
							console.info(
								`🗑️ Removed non-AI event: "${eventData.title}"`
							);
						}
					}
				} catch (error) {
					console.error("Error processing event:", {
						error,
						eventId: googleEvent.id,
					});
				}
			}

			// Add to totals
			totalEventsProcessed += userEventsProcessed;
			totalAiEventsFound += aiEventsFound;
			totalAiEventsStored += aiEventsStored;
		}

		// Silent operation - only log parsed AI commands
	} catch (error) {
		console.error("❌ AI-only detection failed:", { error });
		process.exit(1);
	} finally {
		await prisma.$disconnect();
	}
}

if (require.main === module) {
	aiOnlyDetectEvents();
}

export { aiOnlyDetectEvents };
