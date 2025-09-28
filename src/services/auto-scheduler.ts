import { createFlowSchedulerService } from "./flow-scheduler";
import { createMultiChainSchedulerService } from "./multi-chain-scheduler";
import { evmBridgeService } from "./evm-bridge";
import { ScheduleParser } from "../utils/schedule-parser";
import { prisma } from "../db/client";
import { ParsedAiCommand } from "../types";

export interface AutoScheduleConfig {
	userId: string;
	enableAutoScheduling: boolean;
	defaultChains: number[]; // Default chains to schedule on
	patterns: {
		[key: string]: string; // Event type -> pattern mapping
	};
	fallbackPattern?: string; // Default pattern if no specific mapping
}

export interface AutoScheduleResult {
	success: boolean;
	scheduledEvents: string[];
	totalSchedules: number;
	errors: string[];
}

export class AutoSchedulerService {
	private flowScheduler = createFlowSchedulerService();
	private multiChainScheduler = createMultiChainSchedulerService();

	/**
	 * Automatically schedule payments from calendar events
	 */
	async processCalendarEvent(eventId: string): Promise<AutoScheduleResult> {
		try {
			console.info("Processing calendar event for auto-scheduling", {
				eventId,
			});

			// Get the calendar event
			const event = await prisma.calendarEvent.findUnique({
				where: { id: eventId },
				include: { user: true },
			});

			if (!event) {
				return {
					success: false,
					scheduledEvents: [],
					totalSchedules: 0,
					errors: ["Calendar event not found"],
				};
			}

			if (!event.isAiEvent || !event.parsedAction) {
				return {
					success: false,
					scheduledEvents: [],
					totalSchedules: 0,
					errors: ["Event is not a valid AI payment event"],
				};
			}

			// Get user's auto-scheduling configuration
			const config = await this.getUserAutoScheduleConfig(event.userId);
			if (!config.enableAutoScheduling) {
				return {
					success: true,
					scheduledEvents: [],
					totalSchedules: 0,
					errors: ["Auto-scheduling disabled for user"],
				};
			}

			// Extract payment details
			const paymentDetails = this.extractPaymentDetails(event);
			if (!paymentDetails) {
				return {
					success: false,
					scheduledEvents: [],
					totalSchedules: 0,
					errors: ["Could not extract payment details from event"],
				};
			}

			// Determine scheduling pattern
			const pattern = this.determineSchedulingPattern(event, config);
			if (!pattern) {
				return {
					success: false,
					scheduledEvents: [],
					totalSchedules: 0,
					errors: ["Could not determine scheduling pattern"],
				};
			}

			// Schedule the payment
			const result = await this.schedulePayment(
				paymentDetails,
				pattern,
				config.defaultChains,
				eventId
			);

			return result;
		} catch (error) {
			console.error(
				"Failed to process calendar event for auto-scheduling",
				{
					error,
					eventId,
				}
			);
			return {
				success: false,
				scheduledEvents: [],
				totalSchedules: 0,
				errors: [
					error instanceof Error ? error.message : "Unknown error",
				],
			};
		}
	}

	/**
	 * Get user's auto-scheduling configuration
	 */
	private async getUserAutoScheduleConfig(
		userId: string
	): Promise<AutoScheduleConfig> {
		// For now, return default configuration
		// In a full implementation, this would be stored in the database
		return {
			userId,
			enableAutoScheduling: true,
			defaultChains: [11155111, 31, 545, 646], // Sepolia, Rootstock, Flow EVM, Flow Cadence
			patterns: {
				salary: "every month",
				rent: "every month",
				subscription: "every month",
				investment: "every week",
				dca: "every day",
				payment: "after 1 hour",
			},
			fallbackPattern: "after 1 hour",
		};
	}

	/**
	 * Extract payment details from calendar event
	 */
	private extractPaymentDetails(event: any): {
		recipient: string;
		amount: string;
		userId: string;
	} | null {
		try {
			let parsedAmount: any;
			let parsedRecipient: any;

			parsedAmount =
				typeof event.parsedAmount === "string"
					? JSON.parse(event.parsedAmount)
					: event.parsedAmount;
			parsedRecipient =
				typeof event.parsedRecipient === "string"
					? JSON.parse(event.parsedRecipient)
					: event.parsedRecipient;

			const amount = parsedAmount?.value || parsedAmount;
			const recipient = parsedRecipient?.address || parsedRecipient;

			if (!amount || !recipient) {
				return null;
			}

			return {
				recipient,
				amount: amount.toString(),
				userId: event.userId,
			};
		} catch (error) {
			console.error("Failed to extract payment details", { error });
			return null;
		}
	}

	/**
	 * Determine scheduling pattern based on event
	 */
	private determineSchedulingPattern(
		event: any,
		config: AutoScheduleConfig
	): string | null {
		// Check for specific patterns based on event title/description
		const title = event.title.toLowerCase();
		const description = event.description?.toLowerCase() || "";

		// Look for keywords in title/description
		for (const [keyword, pattern] of Object.entries(config.patterns)) {
			if (title.includes(keyword) || description.includes(keyword)) {
				return pattern;
			}
		}

		// Check if event has a specific scheduled time
		if (event.parsedScheduledTime) {
			const scheduledTime = new Date(event.parsedScheduledTime);
			const now = new Date();
			const delayMs = scheduledTime.getTime() - now.getTime();

			if (delayMs > 0) {
				// Calculate appropriate delay pattern
				const delayMinutes = Math.floor(delayMs / (1000 * 60));
				const delayHours = Math.floor(delayMs / (1000 * 60 * 60));
				const delayDays = Math.floor(delayMs / (1000 * 60 * 60 * 24));

				if (delayDays > 0) {
					return `after ${delayDays} day${delayDays > 1 ? "s" : ""}`;
				} else if (delayHours > 0) {
					return `after ${delayHours} hour${
						delayHours > 1 ? "s" : ""
					}`;
				} else if (delayMinutes > 0) {
					return `after ${delayMinutes} minute${
						delayMinutes > 1 ? "s" : ""
					}`;
				}
			}
		}

		// Use fallback pattern
		return config.fallbackPattern || "after 1 hour";
	}

	/**
	 * Schedule payment with determined pattern
	 */
	private async schedulePayment(
		paymentDetails: { recipient: string; amount: string; userId: string },
		pattern: string,
		chains: number[],
		eventId: string
	): Promise<AutoScheduleResult> {
		try {
			console.info("Auto-scheduling payment", {
				pattern,
				chains,
				recipient: paymentDetails.recipient,
				amount: paymentDetails.amount,
			});

			// Validate the pattern first
			const validation = ScheduleParser.validatePattern(pattern);
			if (!validation.isValid) {
				return {
					success: false,
					scheduledEvents: [],
					totalSchedules: 0,
					errors: [`Invalid pattern: ${validation.error}`],
				};
			}

			// Separate Flow chains from other chains
			const flowChains = chains.filter(
				(chainId) => chainId === 545 || chainId === 646
			); // Flow EVM and Flow Cadence
			const otherChains = chains.filter(
				(chainId) => chainId !== 545 && chainId !== 646
			);

			let totalSchedules = 0;
			const allResults: any = {};
			let successfulChains = 0;
			let failedChains = 0;

			// Schedule on Flow chains using EVM Bridge
			if (flowChains.length > 0) {
				console.info("🚀 Scheduling on Flow chains using EVM Bridge", {
					flowChains,
				});

				for (const chainId of flowChains) {
					try {
						// Use EVM Bridge for all Flow scheduling (it handles both EVM and Cadence)
						console.info("Using EVM Bridge for Flow chain", {
							chainId,
						});

						// Parse the pattern to get scheduling times
						const parsedPattern =
							ScheduleParser.parseNaturalLanguage(pattern);
						if (parsedPattern.error) {
							throw new Error(
								`Invalid pattern: ${parsedPattern.error}`
							);
						}

						const scheduleResults = [];
						for (const executionTime of parsedPattern.executions) {
							const delaySeconds = Math.max(
								0,
								Math.floor(
									(executionTime.getTime() - Date.now()) /
										1000
								)
							);

							const result =
								await evmBridgeService.scheduleFromCalendarEvent(
									paymentDetails.recipient,
									paymentDetails.amount,
									delaySeconds,
									eventId
								);

							scheduleResults.push(result);
						}

						const successfulSchedules = scheduleResults.filter(
							(r) => r.success
						);
						const failedSchedules = scheduleResults.filter(
							(r) => !r.success
						);

						if (successfulSchedules.length > 0) {
							allResults[chainId] = {
								success: true,
								scheduleIds: successfulSchedules
									.map((r) => r.scheduleId)
									.filter(Boolean),
								txHashes: successfulSchedules
									.map((r) => r.transactionHash)
									.filter(Boolean),
								scheduledTimes: parsedPattern.executions.map(
									(executionTime) =>
										executionTime.toISOString()
								),
							};
							totalSchedules += successfulSchedules.length;
							successfulChains++;
						} else {
							allResults[chainId] = {
								success: false,
								error:
									failedSchedules
										.map((r) => r.error)
										.join(", ") || "All schedules failed",
							};
							failedChains++;
						}
					} catch (error) {
						allResults[chainId] = {
							success: false,
							error:
								error instanceof Error
									? error.message
									: "Unknown error",
						};
						failedChains++;
					}
				}
			}

			// Schedule on other chains using Multi-Chain Scheduler
			if (otherChains.length > 0) {
				console.info(
					"Scheduling on other chains using Multi-Chain Scheduler",
					{ otherChains }
				);

				const result =
					await this.multiChainScheduler.schedulePatternMultiChain(
						paymentDetails.recipient,
						paymentDetails.amount,
						paymentDetails.userId,
						pattern,
						otherChains
					);

				if (result.success) {
					Object.assign(allResults, result.results);
					totalSchedules += result.totalSchedules;
					successfulChains += result.successfulChains;
					failedChains += result.failedChains;
				} else {
					// Mark all other chains as failed
					otherChains.forEach((chainId) => {
						allResults[chainId] = {
							success: false,
							error: "Multi-chain scheduling failed",
						};
						failedChains++;
					});
				}
			}

			// Update the calendar event with scheduling info
			try {
				const flowTxHashes = Object.values(allResults)
					.filter((r: any) => r.success && r.txHashes)
					.map((r: any) => r.txHashes)
					.flat()
					.join(",");

				await prisma.calendarEvent.update({
					where: { id: eventId },
					data: {
						flowScheduleId: `auto-${Date.now()}`,
						flowEvmTxHash: flowTxHashes,
					},
				});
			} catch (updateError) {
				console.warn(
					"Failed to update calendar event with auto-schedule info",
					{
						updateError,
					}
				);
			}

			console.info("Auto-scheduling completed", {
				totalSchedules,
				successfulChains,
				failedChains,
			});

			return {
				success: successfulChains > 0,
				scheduledEvents: [eventId],
				totalSchedules,
				errors: [],
			};
		} catch (error) {
			console.error("Failed to auto-schedule payment", { error });
			return {
				success: false,
				scheduledEvents: [],
				totalSchedules: 0,
				errors: [
					error instanceof Error ? error.message : "Unknown error",
				],
			};
		}
	}

	/**
	 * Process all pending calendar events for auto-scheduling
	 */
	async processAllPendingEvents(): Promise<{
		processed: number;
		successful: number;
		failed: number;
		errors: string[];
	}> {
		try {
			console.info("Processing all pending events for auto-scheduling");

			// Get all AI events that haven't been scheduled yet
			const events = await prisma.calendarEvent.findMany({
				where: {
					isAiEvent: true,
					parsedAction: { not: null },
					flowScheduleId: null, // Not yet scheduled
				},
				include: { user: true },
			});

			console.info("Found pending events for auto-scheduling", {
				count: events.length,
			});

			let successful = 0;
			let failed = 0;
			const errors: string[] = [];

			for (const event of events) {
				try {
					const result = await this.processCalendarEvent(event.id);
					if (result.success) {
						successful++;
						console.info("Event auto-scheduled successfully", {
							eventId: event.id,
							totalSchedules: result.totalSchedules,
						});
					} else {
						failed++;
						errors.push(...result.errors);
					}
				} catch (error) {
					failed++;
					const errorMsg =
						error instanceof Error
							? error.message
							: "Unknown error";
					errors.push(`Event ${event.id}: ${errorMsg}`);
					console.error("Failed to auto-schedule event", {
						eventId: event.id,
						error,
					});
				}
			}

			console.info("Auto-scheduling processing completed", {
				processed: events.length,
				successful,
				failed,
			});

			return {
				processed: events.length,
				successful,
				failed,
				errors,
			};
		} catch (error) {
			console.error(
				"Failed to process pending events for auto-scheduling",
				{ error }
			);
			return {
				processed: 0,
				successful: 0,
				failed: 1,
				errors: [
					error instanceof Error ? error.message : "Unknown error",
				],
			};
		}
	}

	/**
	 * Update user's auto-scheduling configuration
	 */
	async updateUserConfig(
		userId: string,
		config: Partial<AutoScheduleConfig>
	): Promise<boolean> {
		try {
			// In a full implementation, this would update the database
			console.info("Updated user auto-scheduling configuration", {
				userId,
				config,
			});
			return true;
		} catch (error) {
			console.error(
				"Failed to update user auto-scheduling configuration",
				{ error }
			);
			return false;
		}
	}
}

export function createAutoSchedulerService(): AutoSchedulerService {
	return new AutoSchedulerService();
}
