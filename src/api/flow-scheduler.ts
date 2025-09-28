import { Router, Request, Response } from "express";
import { createFlowSchedulerService } from "../services/flow-scheduler";
import { prisma } from "../db/client";
import {
	ApiResponse,
	FlowScheduleRequest,
	FlowScheduledPayment,
	AdvancedScheduleRequest,
	RecurringSchedule,
	CustomSchedule,
} from "../types";
import Joi from "joi";
import rateLimit from "express-rate-limit";

const router = Router();
const flowSchedulerService = createFlowSchedulerService();

// Validation schemas
const schedulePaymentSchema = Joi.object({
	recipient: Joi.string().required(),
	amount: Joi.string().required(),
	delaySeconds: Joi.number().integer().min(0).required(),
	userId: Joi.string().required(),
	eventId: Joi.string().optional(),
	description: Joi.string().optional(),
	method: Joi.string().valid("evm", "cadence").default("evm"),
});

const executePaymentSchema = Joi.object({
	paymentId: Joi.string().required(),
});

// Advanced scheduling validation schemas
const advancedScheduleSchema = Joi.object({
	recipient: Joi.string().required(),
	amount: Joi.string().required(),
	userId: Joi.string().required(),
	eventId: Joi.string().optional(),
	description: Joi.string().optional(),
	method: Joi.string().valid("evm", "cadence").default("evm"),
	scheduleType: Joi.string().valid("once", "recurring", "custom").required(),
	// For one-time scheduling
	delaySeconds: Joi.number().integer().min(0).optional(),
	scheduledTime: Joi.date().optional(),
	// For recurring scheduling
	recurringSchedule: Joi.object({
		type: Joi.string()
			.valid("daily", "weekly", "monthly", "yearly", "custom")
			.required(),
		interval: Joi.number().integer().min(1).required(),
		startDate: Joi.date().required(),
		endDate: Joi.date().optional(),
		daysOfWeek: Joi.array()
			.items(Joi.number().integer().min(0).max(6))
			.optional(),
		dayOfMonth: Joi.number().integer().min(1).max(31).optional(),
		timeOfDay: Joi.string()
			.pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
			.optional(),
		timezone: Joi.string().optional(),
	}).optional(),
	// For custom scheduling
	customSchedule: Joi.object({
		type: Joi.string().valid("custom").required(),
		pattern: Joi.string().required(),
		startDate: Joi.date().required(),
		endDate: Joi.date().optional(),
		timezone: Joi.string().optional(),
	}).optional(),
});

const patternScheduleSchema = Joi.object({
	recipient: Joi.string().required(),
	amount: Joi.string().required(),
	userId: Joi.string().required(),
	pattern: Joi.string().required(),
	method: Joi.string().valid("evm", "cadence").default("evm"),
	eventId: Joi.string().optional(),
	description: Joi.string().optional(),
});

const validatePatternSchema = Joi.object({
	pattern: Joi.string().required(),
});

// Rate limiting for scheduling operations
const scheduleLimit = rateLimit({
	windowMs: 1 * 60 * 1000, // 1 minute
	max: 5, // 5 schedules per minute per IP
	message: {
		success: false,
		error: "Too many scheduling requests. Please try again later.",
	} as ApiResponse,
});

/**
 * Schedule a payment using Flow scheduler
 */
router.post("/schedule", scheduleLimit, async (req: Request, res: Response) => {
	try {
		// Validate input
		const { error, value } = schedulePaymentSchema.validate(req.body);
		if (error) {
			return res.status(400).json({
				success: false,
				error: "Invalid input data",
				details: error.details[0]?.message || "Validation error",
			} as ApiResponse);
		}

		const {
			recipient,
			amount,
			delaySeconds,
			userId,
			eventId,
			description,
			method,
		} = value;

		console.info("Scheduling Flow payment", {
			recipient,
			amount,
			delaySeconds,
			userId,
			method,
		});

		// Verify user exists
		const user = await prisma.user.findUnique({
			where: { id: userId },
		});

		if (!user) {
			return res.status(404).json({
				success: false,
				error: "User not found",
			} as ApiResponse);
		}

		// Schedule the payment based on method
		let result;
		if (method === "cadence") {
			result = await flowSchedulerService.schedulePaymentViaCadence({
				recipient,
				amount,
				delaySeconds,
				userId,
			});
		} else {
			result = await flowSchedulerService.schedulePaymentViaEVM({
				recipient,
				amount,
				delaySeconds,
				userId,
			});
		}

		if (!result.success) {
			return res.status(500).json({
				success: false,
				error: result.error || "Failed to schedule payment",
			} as ApiResponse);
		}

		// Store the scheduled payment in database
		const scheduledTime = new Date(Date.now() + delaySeconds * 1000);

		try {
			await prisma.flowScheduledPayment.create({
				data: {
					scheduleId: result.scheduleId || `${method}-${Date.now()}`,
					userId,
					recipient,
					amount,
					delaySeconds,
					scheduledTime,
					method,
					evmTxHash: result.evmTxHash,
					cadenceTxId: result.cadenceTxId,
					eventId,
					description,
					executed: false,
				},
			});
		} catch (dbError) {
			console.warn("Failed to store scheduled payment in database", {
				dbError,
			});
			// Continue - the payment is still scheduled on-chain
		}

		console.info("Payment scheduled successfully", {
			scheduleId: result.scheduleId,
			method,
			scheduledTime,
		});

		return res.json({
			success: true,
			data: {
				scheduleId: result.scheduleId,
				evmTxHash: result.evmTxHash,
				cadenceTxId: result.cadenceTxId,
				scheduledTime,
				method,
				message: `Payment scheduled successfully via ${method.toUpperCase()}`,
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Failed to schedule payment", { error });
		return res.status(500).json({
			success: false,
			error: "Failed to schedule payment",
			details: error instanceof Error ? error.message : "Unknown error",
		} as ApiResponse);
	}
});

/**
 * Get all scheduled payments
 */
router.get("/payments", async (req: Request, res: Response) => {
	try {
		const { userId, recipient, executed } = req.query;

		console.info("Fetching scheduled payments", {
			userId,
			recipient,
			executed,
		});

		let payments: any[] = [];

		// Get from Cadence contract
		const cadenceResult =
			await flowSchedulerService.getAllScheduledPayments();
		if (cadenceResult.success && cadenceResult.payments) {
			payments = cadenceResult.payments;
		}

		// Filter by user if specified
		if (userId) {
			// Get user's payments from database to match with on-chain data
			const userPayments = await prisma.flowScheduledPayment.findMany({
				where: { userId: userId as string },
				orderBy: { createdAt: "desc" },
			});

			// Match with on-chain data
			payments = payments.filter((payment) =>
				userPayments.some((up: any) => up.scheduleId === payment.id)
			);
		}

		// Filter by recipient if specified
		if (recipient) {
			payments = payments.filter(
				(payment) =>
					payment.recipient.toLowerCase() ===
					(recipient as string).toLowerCase()
			);
		}

		// Filter by execution status if specified
		if (executed !== undefined) {
			const isExecuted = executed === "true";
			payments = payments.filter(
				(payment) => payment.executed === isExecuted
			);
		}

		return res.json({
			success: true,
			data: {
				payments,
				totalCount: payments.length,
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Failed to fetch scheduled payments", { error });
		return res.status(500).json({
			success: false,
			error: "Failed to fetch scheduled payments",
		} as ApiResponse);
	}
});

/**
 * Get scheduled payments for a specific recipient
 */
router.get(
	"/payments/recipient/:address",
	async (req: Request, res: Response) => {
		try {
			const { address } = req.params;

			console.info("Fetching payments for recipient", { address });

			if (!address) {
				return res.status(400).json({
					success: false,
					error: "Address parameter is required",
				} as ApiResponse);
			}

			const result =
				await flowSchedulerService.getScheduledPaymentsForRecipient(
					address
				);

			if (!result.success) {
				return res.status(500).json({
					success: false,
					error: result.error || "Failed to fetch payments",
				} as ApiResponse);
			}

			return res.json({
				success: true,
				data: {
					payments: result.payments || [],
					scheduleIds: result.scheduleIds || [],
					recipient: address,
				},
			} as ApiResponse);
		} catch (error) {
			console.error("Failed to fetch payments for recipient", { error });
			return res.status(500).json({
				success: false,
				error: "Failed to fetch payments for recipient",
			} as ApiResponse);
		}
	}
);

/**
 * Get a specific scheduled payment by ID
 */
router.get("/payments/:paymentId", async (req: Request, res: Response) => {
	try {
		const { paymentId } = req.params;

		console.info("Fetching payment by ID", { paymentId });

		const result = await flowSchedulerService.getScheduledPaymentById(
			paymentId as string
		);

		if (!result.success) {
			return res.status(404).json({
				success: false,
				error: result.error || "Payment not found",
			} as ApiResponse);
		}

		return res.json({
			success: true,
			data: {
				payment: result.payment,
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Failed to fetch payment by ID", { error });
		return res.status(500).json({
			success: false,
			error: "Failed to fetch payment",
		} as ApiResponse);
	}
});

/**
 * Execute a scheduled payment
 */
router.post("/execute", async (req: Request, res: Response) => {
	try {
		// Validate input
		const { error, value } = executePaymentSchema.validate(req.body);
		if (error) {
			return res.status(400).json({
				success: false,
				error: "Invalid input data",
				details: error.details[0]?.message || "Validation error",
			} as ApiResponse);
		}

		const { paymentId } = value;

		console.info("Executing scheduled payment", { paymentId });

		// Check if payment is ready for execution
		const readinessCheck =
			await flowSchedulerService.isPaymentReadyForExecution(
				paymentId as string
			);

		if (!readinessCheck.ready) {
			return res.status(400).json({
				success: false,
				error:
					readinessCheck.error ||
					"Payment is not ready for execution",
				data: {
					timeRemaining: readinessCheck.timeRemaining,
				},
			} as ApiResponse);
		}

		// Execute the payment
		const result = await flowSchedulerService.executeScheduledPayment(
			paymentId as string
		);

		if (!result.success) {
			return res.status(500).json({
				success: false,
				error: result.error || "Failed to execute payment",
			} as ApiResponse);
		}

		// Update database record if exists
		try {
			await prisma.flowScheduledPayment.updateMany({
				where: { scheduleId: paymentId },
				data: {
					executed: true,
					executedAt: new Date(),
					executionTxId: result.evmTxHash,
				},
			});
		} catch (dbError) {
			console.warn("Failed to update database record", {
				dbError,
				paymentId,
			});
			// Continue - execution was successful on-chain
		}

		console.info("Payment executed successfully", {
			paymentId,
			evmTxHash: result.evmTxHash,
		});

		return res.json({
			success: true,
			data: {
				paymentId,
				evmTxHash: result.evmTxHash,
				executedAt: new Date(),
				message: "Payment executed successfully",
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Failed to execute payment", { error });
		return res.status(500).json({
			success: false,
			error: "Failed to execute payment",
			details: error instanceof Error ? error.message : "Unknown error",
		} as ApiResponse);
	}
});

/**
 * Process all ready payments (for manual triggering or cron jobs)
 */
router.post("/process-ready", async (req: Request, res: Response) => {
	try {
		console.info("Processing all ready payments");

		const result = await flowSchedulerService.processReadyPayments();

		return res.json({
			success: true,
			data: {
				processed: result.processed,
				successful: result.successful,
				failed: result.failed,
				errors: result.errors,
				message: `Processed ${result.processed} payments: ${result.successful} successful, ${result.failed} failed`,
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Failed to process ready payments", { error });
		return res.status(500).json({
			success: false,
			error: "Failed to process ready payments",
			details: error instanceof Error ? error.message : "Unknown error",
		} as ApiResponse);
	}
});

/**
 * Schedule payment from calendar event (integration endpoint)
 */
router.post("/schedule-from-event", async (req: Request, res: Response) => {
	try {
		const { eventId } = req.body;

		if (!eventId) {
			return res.status(400).json({
				success: false,
				error: "Event ID is required",
			} as ApiResponse);
		}

		// Get the calendar event
		const event = await prisma.calendarEvent.findUnique({
			where: { id: eventId },
			include: { user: true },
		});

		if (!event) {
			return res.status(404).json({
				success: false,
				error: "Calendar event not found",
			} as ApiResponse);
		}

		if (!event.isAiEvent || !event.parsedAction) {
			return res.status(400).json({
				success: false,
				error: "Event is not a valid AI payment event",
			} as ApiResponse);
		}

		// Extract payment details from parsed data
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
			return res.status(400).json({
				success: false,
				error: "Invalid parsed event data",
			} as ApiResponse);
		}

		const amount = parsedAmount?.value || parsedAmount;
		const recipient = parsedRecipient?.address || parsedRecipient;

		if (!amount || !recipient) {
			return res.status(400).json({
				success: false,
				error: "Missing required payment details (amount or recipient)",
			} as ApiResponse);
		}

		// Calculate delay from event scheduled time
		const scheduledTime = event.parsedScheduledTime || event.startTime;
		const delaySeconds = Math.max(
			0,
			Math.floor((scheduledTime.getTime() - Date.now()) / 1000)
		);

		// Schedule the payment
		const scheduleRequest: FlowScheduleRequest = {
			recipient,
			amount: amount.toString(),
			delaySeconds,
			userId: event.userId,
			eventId: event.id,
			description: `Payment from calendar event: ${event.title}`,
		};

		// Use EVM method by default for calendar integration
		const result = await flowSchedulerService.schedulePaymentViaEVM(
			scheduleRequest
		);

		if (!result.success) {
			return res.status(500).json({
				success: false,
				error: result.error || "Failed to schedule payment from event",
			} as ApiResponse);
		}

		// Update the calendar event with scheduling info
		try {
			await prisma.calendarEvent.update({
				where: { id: eventId },
				data: {
					flowScheduleId: result.scheduleId,
					flowEvmTxHash: result.evmTxHash,
					flowCadenceTxId: result.cadenceTxId,
				},
			});
		} catch (updateError) {
			console.warn(
				"Failed to update calendar event with Flow schedule info",
				{ updateError }
			);
		}

		// Store in Flow scheduled payments table
		try {
			await prisma.flowScheduledPayment.create({
				data: {
					scheduleId: result.scheduleId || `event-${eventId}`,
					userId: event.userId,
					recipient,
					amount: amount.toString(),
					delaySeconds,
					scheduledTime,
					method: "evm",
					evmTxHash: result.evmTxHash,
					cadenceTxId: result.cadenceTxId,
					eventId: event.id,
					description: scheduleRequest.description,
					executed: false,
				},
			});
		} catch (dbError) {
			console.warn("Failed to store Flow scheduled payment", { dbError });
		}

		console.info("Payment scheduled from calendar event", {
			eventId,
			scheduleId: result.scheduleId,
			recipient,
			amount,
			delaySeconds,
		});

		return res.json({
			success: true,
			data: {
				scheduleId: result.scheduleId,
				evmTxHash: result.evmTxHash,
				cadenceTxId: result.cadenceTxId,
				scheduledTime,
				eventId,
				message: "Payment scheduled from calendar event",
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Failed to schedule payment from event", { error });
		return res.status(500).json({
			success: false,
			error: "Failed to schedule payment from event",
			details: error instanceof Error ? error.message : "Unknown error",
		} as ApiResponse);
	}
});

/**
 * Schedule advanced payment patterns (recurring, custom, etc.)
 */
router.post(
	"/schedule-advanced",
	scheduleLimit,
	async (req: Request, res: Response) => {
		try {
			// Validate input
			const { error, value } = advancedScheduleSchema.validate(req.body);
			if (error) {
				return res.status(400).json({
					success: false,
					error: "Invalid input data",
					details: error.details[0]?.message || "Validation error",
				} as ApiResponse);
			}

			const request: AdvancedScheduleRequest = value;

			console.info("Scheduling advanced payment", {
				scheduleType: request.scheduleType,
				recipient: request.recipient,
				amount: request.amount,
				userId: request.userId,
			});

			// Verify user exists
			const user = await prisma.user.findUnique({
				where: { id: request.userId },
			});

			if (!user) {
				return res.status(404).json({
					success: false,
					error: "User not found",
				} as ApiResponse);
			}

			// Schedule the advanced payment
			const result = await flowSchedulerService.scheduleAdvancedPayment(
				request
			);

			if (!result.success) {
				return res.status(500).json({
					success: false,
					error:
						result.error || "Failed to schedule advanced payment",
				} as ApiResponse);
			}

			// Store scheduled payments in database
			if (
				result.scheduleIds &&
				result.scheduledTimes &&
				result.scheduleIds.length === result.scheduledTimes.length
			) {
				try {
					for (let i = 0; i < result.scheduleIds.length; i++) {
						const scheduleId = result.scheduleIds[i];
						const scheduledTime = result.scheduledTimes[i];

						if (scheduleId && scheduledTime) {
							await prisma.flowScheduledPayment.create({
								data: {
									scheduleId,
									userId: request.userId,
									recipient: request.recipient,
									amount: request.amount,
									delaySeconds: Math.floor(
										(scheduledTime.getTime() - Date.now()) /
											1000
									),
									scheduledTime,
									method: request.method || "evm",
									evmTxHash:
										result.evmTxHashes?.[i] || undefined,
									cadenceTxId:
										result.cadenceTxIds?.[i] || undefined,
									eventId: request.eventId,
									description: request.description,
									executed: false,
								},
							});
						}
					}
				} catch (dbError) {
					console.warn(
						"Failed to store advanced scheduled payments in database",
						{
							dbError,
						}
					);
					// Continue - the payments are still scheduled on-chain
				}
			}

			console.info("Advanced payment scheduled successfully", {
				scheduleIds: result.scheduleIds,
				scheduleType: request.scheduleType,
				executionCount: result.scheduleIds?.length || 0,
			});

			return res.json({
				success: true,
				data: {
					scheduleIds: result.scheduleIds,
					evmTxHashes: result.evmTxHashes,
					cadenceTxIds: result.cadenceTxIds,
					scheduledTimes: result.scheduledTimes,
					executionCount: result.scheduleIds?.length || 0,
					message: `Advanced payment scheduled successfully with ${
						result.scheduleIds?.length || 0
					} executions`,
				},
			} as ApiResponse);
		} catch (error) {
			console.error("Failed to schedule advanced payment", { error });
			return res.status(500).json({
				success: false,
				error: "Failed to schedule advanced payment",
				details:
					error instanceof Error ? error.message : "Unknown error",
			} as ApiResponse);
		}
	}
);

/**
 * Schedule payment with natural language pattern
 */
router.post(
	"/schedule-pattern",
	scheduleLimit,
	async (req: Request, res: Response) => {
		try {
			// Validate input
			const { error, value } = patternScheduleSchema.validate(req.body);
			if (error) {
				return res.status(400).json({
					success: false,
					error: "Invalid input data",
					details: error.details[0]?.message || "Validation error",
				} as ApiResponse);
			}

			const {
				recipient,
				amount,
				userId,
				pattern,
				method,
				eventId,
				description,
			} = value;

			console.info("Scheduling payment with pattern", {
				pattern,
				recipient,
				amount,
				userId,
			});

			// Verify user exists
			const user = await prisma.user.findUnique({
				where: { id: userId },
			});

			if (!user) {
				return res.status(404).json({
					success: false,
					error: "User not found",
				} as ApiResponse);
			}

			// Schedule the payment with pattern
			const result = await flowSchedulerService.scheduleWithPattern(
				recipient,
				amount,
				userId,
				pattern,
				method
			);

			if (!result.success) {
				return res.status(500).json({
					success: false,
					error:
						result.error ||
						"Failed to schedule payment with pattern",
				} as ApiResponse);
			}

			// Store scheduled payments in database
			if (
				result.scheduleIds &&
				result.scheduledTimes &&
				result.scheduleIds.length === result.scheduledTimes.length
			) {
				try {
					for (let i = 0; i < result.scheduleIds.length; i++) {
						const scheduleId = result.scheduleIds[i];
						const scheduledTime = result.scheduledTimes[i];

						if (scheduleId && scheduledTime) {
							await prisma.flowScheduledPayment.create({
								data: {
									scheduleId,
									userId,
									recipient,
									amount,
									delaySeconds: Math.floor(
										(scheduledTime.getTime() - Date.now()) /
											1000
									),
									scheduledTime,
									method: method || "evm",
									evmTxHash:
										result.evmTxHashes?.[i] || undefined,
									cadenceTxId:
										result.cadenceTxIds?.[i] || undefined,
									eventId,
									description:
										description || `Pattern: ${pattern}`,
									executed: false,
								},
							});
						}
					}
				} catch (dbError) {
					console.warn(
						"Failed to store pattern scheduled payments in database",
						{
							dbError,
						}
					);
					// Continue - the payments are still scheduled on-chain
				}
			}

			console.info("Pattern payment scheduled successfully", {
				pattern,
				scheduleIds: result.scheduleIds,
				executionCount: result.scheduleIds?.length || 0,
			});

			return res.json({
				success: true,
				data: {
					pattern,
					scheduleIds: result.scheduleIds,
					evmTxHashes: result.evmTxHashes,
					cadenceTxIds: result.cadenceTxIds,
					scheduledTimes: result.scheduledTimes,
					executionCount: result.scheduleIds?.length || 0,
					message: `Payment scheduled successfully with pattern: ${pattern}`,
				},
			} as ApiResponse);
		} catch (error) {
			console.error("Failed to schedule payment with pattern", { error });
			return res.status(500).json({
				success: false,
				error: "Failed to schedule payment with pattern",
				details:
					error instanceof Error ? error.message : "Unknown error",
			} as ApiResponse);
		}
	}
);

/**
 * Validate a scheduling pattern
 */
router.post("/validate-pattern", async (req: Request, res: Response) => {
	try {
		// Validate input
		const { error, value } = validatePatternSchema.validate(req.body);
		if (error) {
			return res.status(400).json({
				success: false,
				error: "Invalid input data",
				details: error.details[0]?.message || "Validation error",
			} as ApiResponse);
		}

		const { pattern } = value;

		console.info("Validating scheduling pattern", { pattern });

		// Validate the pattern
		const result = await flowSchedulerService.validateSchedulePattern(
			pattern
		);

		return res.json({
			success: true,
			data: {
				pattern,
				valid: result.valid,
				nextExecution: result.nextExecution,
				executionCount: result.executionCount,
				error: result.error,
				message: result.valid
					? `Pattern is valid with ${result.executionCount} executions`
					: `Pattern is invalid: ${result.error}`,
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Failed to validate pattern", { error });
		return res.status(500).json({
			success: false,
			error: "Failed to validate pattern",
			details: error instanceof Error ? error.message : "Unknown error",
		} as ApiResponse);
	}
});

/**
 * Get supported scheduling patterns
 */
router.get("/patterns", async (req: Request, res: Response) => {
	try {
		const supportedPatterns = [
			{
				category: "Time-based",
				patterns: [
					"after 5 minutes",
					"after 1 hour",
					"after 2 days",
					"after 1 week",
					"after 1 month",
				],
			},
			{
				category: "Recurring",
				patterns: [
					"every 1 minute",
					"every 5 minutes",
					"every 1 hour",
					"every day",
					"every week",
					"every month",
				],
			},
			{
				category: "Conditional",
				patterns: [
					"every day until 2024-12-31",
					"every week for 3 months",
					"every month for 1 year",
				],
			},
		];

		return res.json({
			success: true,
			data: {
				patterns: supportedPatterns,
				message: "Supported scheduling patterns",
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Failed to get supported patterns", { error });
		return res.status(500).json({
			success: false,
			error: "Failed to get supported patterns",
		} as ApiResponse);
	}
});

export default router;
