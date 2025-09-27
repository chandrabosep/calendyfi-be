import { Router, Request, Response } from "express";
import { createFlowSchedulerService } from "../services/flow-scheduler";
import { prisma } from "../db/client";
import {
	ApiResponse,
	FlowScheduleRequest,
	FlowScheduledPayment,
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
				userPayments.some((up) => up.scheduleId === payment.id)
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
			paymentId
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
			await flowSchedulerService.isPaymentReadyForExecution(paymentId);

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
			paymentId
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
					executionTxId: result.txId,
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
			txId: result.txId,
		});

		return res.json({
			success: true,
			data: {
				paymentId,
				txId: result.txId,
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

export default router;
