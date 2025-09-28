import { Router, Request, Response } from "express";
import { createCalendarApiService } from "../services/calendar-api";
import { createFlowSchedulerService } from "../services/flow-scheduler";
import { prisma } from "../db/client";
import { decrypt } from "../utils/encryption";
import { ApiResponse } from "../types";

const router = Router();

// Webhook endpoint for Google Calendar push notifications
router.post("/webhook", async (req: Request, res: Response) => {
	try {
		const { headers, body } = req;

		// Validate webhook authenticity (simplified - in production, verify X-Goog headers)
		const resourceId = headers["x-goog-resource-id"] as string;
		const resourceState = headers["x-goog-resource-state"] as string;

		if (!resourceId || !resourceState) {
			console.warn("Invalid webhook headers", { headers });
			return res.status(400).json({
				success: false,
				error: "Invalid webhook headers",
			} as ApiResponse);
		}

		console.info("Received calendar webhook", {
			resourceId,
			resourceState,
			headers: Object.keys(headers),
		});

		// Handle different resource states
		if (resourceState === "sync") {
			// Initial sync - fetch all events
			await handleCalendarSync(resourceId);
		} else if (resourceState === "update") {
			// Calendar updated - fetch recent events
			await handleCalendarUpdate(resourceId);
		}

		return res.status(200).json({
			success: true,
			message: "Webhook processed successfully",
		} as ApiResponse);
	} catch (error) {
		console.error("Webhook processing failed", { error });
		return res.status(500).json({
			success: false,
			error: "Webhook processing failed",
		} as ApiResponse);
	}
});

// Fetch AI events with parsed command data for a user
router.get("/events/ai", async (req: Request, res: Response) => {
	try {
		const userId = req.query.userId as string;

		if (!userId) {
			return res.status(400).json({
				success: false,
				error: "User ID is required",
			} as ApiResponse);
		}

		const aiEvents = await prisma.calendarEvent.findMany({
			where: {
				userId,
				isAiEvent: true,
			},
			select: {
				id: true,
				googleEventId: true,
				title: true,
				description: true,
				startTime: true,
				endTime: true,
				parsedIntent: true,
				parsedAction: true,
				parsedAmount: true,
				parsedRecipient: true,
				parsedFromToken: true,
				parsedToToken: true,
				parsedProtocol: true,
				parsedChain: true,
				parsedParticipants: true,
				parsedPool: true,
				parsedPlatform: true,
				parsedConfidence: true,
				parsedScheduledTime: true,
				parsedCommandRaw: true,
				createdAt: true,
				updatedAt: true,
			},
			orderBy: {
				startTime: "desc",
			},
		});

		console.info("Fetched AI events with parsed data", {
			userId,
			eventCount: aiEvents.length,
		});

		return res.json({
			success: true,
			data: {
				events: aiEvents,
				totalCount: aiEvents.length,
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Failed to fetch AI events", { error });
		return res.status(500).json({
			success: false,
			error: "Failed to fetch AI events",
		} as ApiResponse);
	}
});

// Fetch recent events for a user
router.get("/events/recent", async (req: Request, res: Response) => {
	try {
		const userId = req.query.userId as string;
		const hoursBack = parseInt(req.query.hoursBack as string) || 24;

		if (!userId) {
			return res.status(400).json({
				success: false,
				error: "User ID is required",
			} as ApiResponse);
		}

		const user = await prisma.user.findUnique({
			where: { id: userId },
		});

		if (!user) {
			return res.status(404).json({
				success: false,
				error: "User not found",
			} as ApiResponse);
		}

		// Decrypt and use refresh token to get fresh access token
		const refreshToken = decrypt(user.refreshToken);
		const calendarService = createCalendarApiService(
			user.accessToken || ""
		);

		const events = await calendarService.getRecentEvents(
			"primary",
			hoursBack
		);

		// Process and store events
		const processedEvents = await processAndStoreEvents(
			events,
			userId,
			"primary",
			user.accessToken || ""
		);

		console.info("Fetched recent events", {
			userId,
			hoursBack,
			eventCount: processedEvents.length,
			aiEventCount: processedEvents.filter((e) => e.isAiEvent).length,
		});

		return res.json({
			success: true,
			data: {
				events: processedEvents,
				totalCount: processedEvents.length,
				aiEventCount: processedEvents.filter((e) => e.isAiEvent).length,
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Failed to fetch recent events", { error });
		return res.status(500).json({
			success: false,
			error: "Failed to fetch recent events",
		} as ApiResponse);
	}
});

// Subscribe to calendar changes
router.post("/subscribe", async (req: Request, res: Response) => {
	try {
		const { userId, calendarId = "primary" } = req.body;

		if (!userId) {
			return res.status(400).json({
				success: false,
				error: "User ID is required",
			} as ApiResponse);
		}

		const user = await prisma.user.findUnique({
			where: { id: userId },
		});

		if (!user) {
			return res.status(404).json({
				success: false,
				error: "User not found",
			} as ApiResponse);
		}

		const calendarService = createCalendarApiService(
			user.accessToken || ""
		);

		// Set expiration to 1 week from now
		const expirationTime = Date.now() + 7 * 24 * 60 * 60 * 1000;
		const webhookUrl = `${
			process.env.WEBHOOK_BASE_URL || "http://localhost:3000"
		}/api/calendar/webhook`;

		const subscription = await calendarService.subscribeToCalendarChanges(
			calendarId,
			webhookUrl,
			expirationTime
		);

		// Store webhook channel info
		await prisma.webhookChannel.create({
			data: {
				userId: user.id,
				channelId: subscription.channelId,
				resourceId: subscription.resourceId,
				expiration: new Date(expirationTime),
			},
		});

		console.info("Subscribed to calendar changes", {
			userId,
			calendarId,
			channelId: subscription.channelId,
			expiration: new Date(expirationTime),
		});

		return res.json({
			success: true,
			data: {
				channelId: subscription.channelId,
				resourceId: subscription.resourceId,
				expiration: new Date(expirationTime),
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Failed to subscribe to calendar", { error });
		return res.status(500).json({
			success: false,
			error: "Failed to subscribe to calendar changes",
		} as ApiResponse);
	}
});

// Helper function to process and store events
async function processAndStoreEvents(
	events: any[],
	userId: string,
	calendarId: string,
	accessToken?: string
): Promise<any[]> {
	const calendarService = createCalendarApiService(accessToken || "");
	const processedEvents = [];

	for (const event of events) {
		try {
			const eventData =
				calendarService.transformGoogleEventToCalendarEventData(
					event,
					userId,
					calendarId
				);

			// Store event in database
			const storedEvent = await prisma.calendarEvent.upsert({
				where: { googleEventId: eventData.googleEventId },
				update: {
					title: eventData.title,
					description: eventData.description,
					startTime: eventData.startTime,
					endTime: eventData.endTime,
					location: eventData.location,
					attendees: eventData.attendees,
					isAiEvent: eventData.isAiEvent,
				},
				create: {
					googleEventId: eventData.googleEventId,
					userId: userId,
					calendarId: eventData.calendarId,
					title: eventData.title,
					description: eventData.description,
					startTime: eventData.startTime,
					endTime: eventData.endTime,
					location: eventData.location,
					attendees: eventData.attendees,
					isAiEvent: eventData.isAiEvent,
				},
			});

			// Log AI events
			if (eventData.isAiEvent) {
				console.info("AI event detected", {
					title: eventData.title,
					description: eventData.description,
					startTime: eventData.startTime,
					endTime: eventData.endTime,
					userId,
				});

				// Process AI event with Gemini
				try {
					const eventText = `${eventData.title} ${
						eventData.description || ""
					}`.trim();

					console.info("Processing AI event", {
						eventId: eventData.googleEventId,
						userId,
						eventText: eventText.substring(0, 100),
					});

					const aiResult = await calendarService.processAiEvent(
						eventText,
						userId,
						eventData.googleEventId,
						eventData.startTime
					);

					if (aiResult.success && aiResult.parsedCommand) {
						const parsedCommand = aiResult.parsedCommand;

						console.info("AI event processed successfully", {
							eventId: eventData.googleEventId,
							userId,
							intent: parsedCommand.intent.type,
							action: parsedCommand.action.type,
							confidence: parsedCommand.confidence,
							scheduledTime:
								parsedCommand.scheduledTime?.toISOString(),
						});

						// Update the stored event with parsed command data
						await prisma.calendarEvent.update({
							where: { googleEventId: eventData.googleEventId },
							data: {
								parsedIntent: parsedCommand.intent.type,
								parsedAction: parsedCommand.action.type,
								parsedAmount:
									parsedCommand.parameters.amount || null,
								parsedRecipient:
									parsedCommand.parameters.recipient || null,
								parsedFromToken:
									parsedCommand.parameters.fromToken || null,
								parsedToToken:
									parsedCommand.parameters.toToken || null,
								parsedProtocol:
									parsedCommand.parameters.protocol || null,
								parsedChain:
									parsedCommand.parameters.chain || null,
								parsedParticipants:
									parsedCommand.parameters.participants ||
									null,
								parsedPool:
									parsedCommand.parameters.pool || null,
								parsedPlatform:
									parsedCommand.parameters.platform || null,
								parsedConfidence: parsedCommand.confidence,
								parsedScheduledTime:
									parsedCommand.scheduledTime || null,
								parsedCommandRaw: parsedCommand,
							},
						});

						console.info("Parsed command data stored in database", {
							eventId: eventData.googleEventId,
							userId,
							intent: parsedCommand.intent.type,
							action: parsedCommand.action.type,
						});

						// Auto-trigger EVM Bridge scheduling for Flow transactions
						if (
							parsedCommand.parameters.chain === "Flow" ||
							parsedCommand.parameters.chain === "Flow EVM" ||
							parsedCommand.parameters.chain === "Flow Cadence" ||
							parsedCommand.action.type === "send" ||
							parsedCommand.action.type === "pay" ||
							parsedCommand.action.type === "transfer"
						) {
							console.info(
								"🚀 Auto-triggering EVM Bridge scheduling for Flow transaction",
								{
									eventId: eventData.googleEventId,
									chain: parsedCommand.parameters.chain,
									action: parsedCommand.action.type,
								}
							);

							// Trigger EVM Bridge scheduling automatically
							try {
								const { evmBridgeService } = await import(
									"../services/evm-bridge"
								);
								const amount =
									parsedCommand.parameters.amount?.value ||
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
										"🤖 Auto-scheduling via EVM Bridge",
										{
											eventId: eventData.googleEventId,
											recipient,
											amount: amount.toString(),
											delaySeconds,
											scheduledTime:
												scheduledTime.toISOString(),
										}
									);

									const evmResult =
										await evmBridgeService.scheduleFromCalendarEvent(
											recipient,
											amount.toString(),
											delaySeconds,
											eventData.googleEventId
										);

									if (evmResult.success) {
										// Update the calendar event with EVM scheduling info
										await prisma.calendarEvent.update({
											where: {
												googleEventId:
													eventData.googleEventId,
											},
											data: {
												flowScheduleId:
													evmResult.scheduleId,
												flowEvmTxHash:
													evmResult.transactionHash,
												flowCadenceTxId: "auto-bridged", // Cadence TX will be triggered automatically
											},
										});

										console.info(
											"🎉 EVM Bridge transaction auto-scheduled successfully",
											{
												eventId:
													eventData.googleEventId,
												scheduleId:
													evmResult.scheduleId,
												evmTxHash:
													evmResult.transactionHash,
												bridgeTriggered: true,
											}
										);
									} else {
										console.warn(
											"❌ Failed to auto-schedule EVM Bridge transaction",
											{
												eventId:
													eventData.googleEventId,
												error: evmResult.error,
											}
										);
									}
								}
							} catch (evmError) {
								console.error(
									"❌ Error auto-scheduling EVM Bridge transaction",
									{
										evmError,
										eventId: eventData.googleEventId,
									}
								);
							}
						}
					} else {
						console.warn("AI event processing failed", {
							eventId: eventData.googleEventId,
							userId,
							error: aiResult.error,
						});
					}
				} catch (error) {
					console.error("Failed to process AI event", {
						error,
						eventId: eventData.googleEventId,
						userId,
					});
				}
			}

			processedEvents.push(storedEvent);
		} catch (error) {
			console.error("Failed to process event", {
				error,
				eventId: event.id,
			});
		}
	}

	return processedEvents;
}

// Helper function to handle calendar sync
async function handleCalendarSync(resourceId: string): Promise<void> {
	// Find user by resource ID
	const webhookChannel = await prisma.webhookChannel.findFirst({
		where: { resourceId },
		include: { user: true },
	});

	if (!webhookChannel) {
		console.warn("No webhook channel found for resource ID", {
			resourceId,
		});
		return;
	}

	const user = webhookChannel.user;
	const calendarService = createCalendarApiService(user.accessToken || "");

	// Fetch all events and process them
	const events = await calendarService.getAllEvents("primary");
	await processAndStoreEvents(
		events,
		user.id,
		"primary",
		user.accessToken || ""
	);

	console.info("Calendar sync completed", {
		userId: user.id,
		eventCount: events.length,
	});
}

// Helper function to handle calendar update
async function handleCalendarUpdate(resourceId: string): Promise<void> {
	// Find user by resource ID
	const webhookChannel = await prisma.webhookChannel.findFirst({
		where: { resourceId },
		include: { user: true },
	});

	if (!webhookChannel) {
		console.warn("No webhook channel found for resource ID", {
			resourceId,
		});
		return;
	}

	const user = webhookChannel.user;
	const calendarService = createCalendarApiService(user.accessToken || "");

	// Fetch recent events and process them
	const events = await calendarService.getRecentEvents("primary", 1); // Last hour
	await processAndStoreEvents(
		events,
		user.id,
		"primary",
		user.accessToken || ""
	);

	console.info("Calendar update processed", {
		userId: user.id,
		eventCount: events.length,
	});
}

// Process AI event and optionally schedule on Flow
router.post("/process-ai-event", async (req: Request, res: Response) => {
	try {
		const { eventId, scheduleOnFlow } = req.body;

		if (!eventId) {
			return res.status(400).json({
				success: false,
				error: "Event ID is required",
			} as ApiResponse);
		}

		// Get the event
		const event = await prisma.calendarEvent.findUnique({
			where: { id: eventId },
			include: { user: true },
		});

		if (!event) {
			return res.status(404).json({
				success: false,
				error: "Event not found",
			} as ApiResponse);
		}

		if (!event.isAiEvent) {
			return res.status(400).json({
				success: false,
				error: "Event is not an AI event",
			} as ApiResponse);
		}

		console.info("Processing AI event for Flow scheduling", {
			eventId,
			scheduleOnFlow,
			userId: event.userId,
		});

		let flowScheduleResult = null;

		// If Flow scheduling is requested and event has payment action
		if (
			scheduleOnFlow &&
			event.parsedAction &&
			(event.parsedAction === "send" ||
				event.parsedAction === "pay" ||
				event.parsedAction === "transfer")
		) {
			try {
				// Extract payment details
				let parsedAmount: any;
				let parsedRecipient: any;

				try {
					parsedAmount =
						typeof event.parsedAmount === "string"
							? JSON.parse(event.parsedAmount)
							: event.parsedAmount;
					parsedRecipient =
						typeof event.parsedRecipient === "string"
							? JSON.parse(event.parsedRecipient)
							: event.parsedRecipient;
				} catch (parseError) {
					console.warn(
						"Failed to parse event data for Flow scheduling",
						{ parseError }
					);
					return res.status(400).json({
						success: false,
						error: "Invalid parsed event data for Flow scheduling",
					} as ApiResponse);
				}

				const amount = parsedAmount?.value || parsedAmount;
				const recipient = parsedRecipient?.address || parsedRecipient;

				if (amount && recipient) {
					// Calculate delay from event scheduled time
					const scheduledTime =
						event.parsedScheduledTime || event.startTime;
					const delaySeconds = Math.max(
						0,
						Math.floor(
							(scheduledTime.getTime() - Date.now()) / 1000
						)
					);

					// Debug: Log the scheduling details
					console.info("Debug: Flow scheduling details", {
						eventId,
						title: event.title,
						startTime: event.startTime.toISOString(),
						parsedScheduledTime:
							event.parsedScheduledTime?.toISOString(),
						scheduledTime: scheduledTime.toISOString(),
						now: new Date().toISOString(),
						delaySeconds,
						delayMinutes: delaySeconds / 60,
						delayHours: delaySeconds / 3600,
						recipient,
						amount: amount.toString(),
					});

					// Warn if delaySeconds is 0 or very small
					if (delaySeconds < 60) {
						console.warn(
							"WARNING: Flow transaction scheduled with very short delay",
							{
								eventId,
								delaySeconds,
								delayMinutes: delaySeconds / 60,
								scheduledTime: scheduledTime.toISOString(),
								now: new Date().toISOString(),
								timeDiff: scheduledTime.getTime() - Date.now(),
							}
						);
					}

					// Prevent scheduling transactions with very short delays to avoid immediate execution
					if (delaySeconds < 10) {
						console.error(
							"ERROR: Flow transaction delay is too short, skipping scheduling",
							{
								eventId,
								delaySeconds,
								scheduledTime: scheduledTime.toISOString(),
								now: new Date().toISOString(),
							}
						);

						return res.json({
							success: false,
							error: "Transaction scheduled time is too close to current time. Please schedule at least 10 seconds in the future.",
							data: {
								scheduledTime: scheduledTime.toISOString(),
								currentTime: new Date().toISOString(),
								delaySeconds,
							},
						} as ApiResponse);
					}

					const flowSchedulerService = createFlowSchedulerService();

					// Schedule on Flow (using EVM method by default)
					flowScheduleResult =
						await flowSchedulerService.schedulePaymentViaEVM({
							recipient,
							amount: amount.toString(),
							delaySeconds,
							userId: event.userId,
						});

					if (flowScheduleResult.success) {
						// Update the calendar event with Flow scheduling info
						await prisma.calendarEvent.update({
							where: { id: eventId },
							data: {
								flowScheduleId: flowScheduleResult.scheduleId,
								flowEvmTxHash: flowScheduleResult.evmTxHash,
								flowCadenceTxId: flowScheduleResult.cadenceTxId,
							},
						});

						// Store in Flow scheduled payments table
						try {
							await prisma.flowScheduledPayment.create({
								data: {
									scheduleId:
										flowScheduleResult.scheduleId ||
										`event-${eventId}`,
									userId: event.userId,
									recipient,
									amount: amount.toString(),
									delaySeconds,
									scheduledTime,
									method: "evm",
									evmTxHash: flowScheduleResult.evmTxHash,
									cadenceTxId: flowScheduleResult.cadenceTxId,
									eventId: event.id,
									description: `Flow payment from AI event: ${event.title}`,
									executed: false,
								},
							});
						} catch (dbError) {
							console.warn(
								"Failed to store Flow scheduled payment",
								{ dbError }
							);
						}

						console.info(
							"AI event scheduled on Flow successfully",
							{
								eventId,
								scheduleId: flowScheduleResult.scheduleId,
								recipient,
								amount,
								delaySeconds,
							}
						);
					} else {
						console.warn("Failed to schedule AI event on Flow", {
							eventId,
							error: flowScheduleResult.error,
						});
					}
				} else {
					console.warn(
						"AI event missing required payment details for Flow scheduling",
						{
							eventId,
							amount,
							recipient,
						}
					);
				}
			} catch (flowError) {
				console.error("Error scheduling AI event on Flow", {
					flowError,
					eventId,
				});
				flowScheduleResult = {
					success: false,
					error:
						flowError instanceof Error
							? flowError.message
							: "Unknown Flow scheduling error",
				};
			}
		}

		return res.json({
			success: true,
			data: {
				eventId,
				eventTitle: event.title,
				isAiEvent: event.isAiEvent,
				parsedAction: event.parsedAction,
				parsedIntent: event.parsedIntent,
				flowScheduling: flowScheduleResult
					? {
							success: flowScheduleResult.success,
							scheduleId: flowScheduleResult.scheduleId,
							evmTxHash: flowScheduleResult.evmTxHash,
							cadenceTxId: flowScheduleResult.cadenceTxId,
							error: flowScheduleResult.error,
					  }
					: null,
				message: flowScheduleResult?.success
					? "AI event processed and scheduled on Flow"
					: "AI event processed",
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Failed to process AI event", { error });
		return res.status(500).json({
			success: false,
			error: "Failed to process AI event",
			details: error instanceof Error ? error.message : "Unknown error",
		} as ApiResponse);
	}
});

export default router;
