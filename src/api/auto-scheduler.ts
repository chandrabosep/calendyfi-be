import { Router, Request, Response } from "express";
import { createAutoSchedulerService } from "../services/auto-scheduler";
import { ApiResponse } from "../types";
import Joi from "joi";
import rateLimit from "express-rate-limit";

const router = Router();
const autoScheduler = createAutoSchedulerService();

// Validation schemas
const processEventSchema = Joi.object({
	eventId: Joi.string().required(),
});

const updateConfigSchema = Joi.object({
	userId: Joi.string().required(),
	enableAutoScheduling: Joi.boolean().optional(),
	defaultChains: Joi.array().items(Joi.number().integer()).optional(),
	patterns: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
	fallbackPattern: Joi.string().optional(),
});

// Rate limiting
const autoScheduleLimit = rateLimit({
	windowMs: 1 * 60 * 1000, // 1 minute
	max: 10, // 10 auto-schedule requests per minute per IP
	message: {
		success: false,
		error: "Too many auto-scheduling requests. Please try again later.",
	} as ApiResponse,
});

/**
 * Process a calendar event for auto-scheduling
 */
router.post(
	"/process-event",
	autoScheduleLimit,
	async (req: Request, res: Response) => {
		try {
			// Validate input
			const { error, value } = processEventSchema.validate(req.body);
			if (error) {
				return res.status(400).json({
					success: false,
					error: "Invalid input data",
					details: error.details[0]?.message || "Validation error",
				} as ApiResponse);
			}

			const { eventId } = value;

			console.info("Processing calendar event for auto-scheduling", {
				eventId,
			});

			// Process the event
			const result = await autoScheduler.processCalendarEvent(eventId);

			if (!result.success) {
				return res.status(500).json({
					success: false,
					error: "Failed to auto-schedule event",
					details: result.errors,
				} as ApiResponse);
			}

			console.info("Event auto-scheduled successfully", {
				eventId,
				totalSchedules: result.totalSchedules,
			});

			return res.json({
				success: true,
				data: {
					eventId,
					scheduledEvents: result.scheduledEvents,
					totalSchedules: result.totalSchedules,
					errors: result.errors,
					message: `Event auto-scheduled successfully with ${result.totalSchedules} total schedules`,
				},
			} as ApiResponse);
		} catch (error) {
			console.error("Failed to process event for auto-scheduling", {
				error,
			});
			return res.status(500).json({
				success: false,
				error: "Failed to process event for auto-scheduling",
				details:
					error instanceof Error ? error.message : "Unknown error",
			} as ApiResponse);
		}
	}
);

/**
 * Process all pending events for auto-scheduling
 */
router.post(
	"/process-all-pending",
	autoScheduleLimit,
	async (req: Request, res: Response) => {
		try {
			console.info("Processing all pending events for auto-scheduling");

			// Process all pending events
			const result = await autoScheduler.processAllPendingEvents();

			return res.json({
				success: true,
				data: {
					processed: result.processed,
					successful: result.successful,
					failed: result.failed,
					errors: result.errors,
					message: `Processed ${result.processed} events: ${result.successful} successful, ${result.failed} failed`,
				},
			} as ApiResponse);
		} catch (error) {
			console.error("Failed to process all pending events", { error });
			return res.status(500).json({
				success: false,
				error: "Failed to process all pending events",
				details:
					error instanceof Error ? error.message : "Unknown error",
			} as ApiResponse);
		}
	}
);

/**
 * Update user's auto-scheduling configuration
 */
router.post(
	"/update-config",
	autoScheduleLimit,
	async (req: Request, res: Response) => {
		try {
			// Validate input
			const { error, value } = updateConfigSchema.validate(req.body);
			if (error) {
				return res.status(400).json({
					success: false,
					error: "Invalid input data",
					details: error.details[0]?.message || "Validation error",
				} as ApiResponse);
			}

			const { userId, ...config } = value;

			console.info("Updating user auto-scheduling configuration", {
				userId,
				config,
			});

			// Update the configuration
			const success = await autoScheduler.updateUserConfig(
				userId,
				config
			);

			if (!success) {
				return res.status(500).json({
					success: false,
					error: "Failed to update auto-scheduling configuration",
				} as ApiResponse);
			}

			return res.json({
				success: true,
				data: {
					userId,
					config,
					message:
						"Auto-scheduling configuration updated successfully",
				},
			} as ApiResponse);
		} catch (error) {
			console.error("Failed to update auto-scheduling configuration", {
				error,
			});
			return res.status(500).json({
				success: false,
				error: "Failed to update auto-scheduling configuration",
				details:
					error instanceof Error ? error.message : "Unknown error",
			} as ApiResponse);
		}
	}
);

/**
 * Get auto-scheduling status
 */
router.get("/status", async (req: Request, res: Response) => {
	try {
		// Get status information
		const status = {
			service: "Auto-Scheduler",
			status: "active",
			features: [
				"Automatic calendar event processing",
				"Multi-chain scheduling",
				"Pattern-based scheduling",
				"User configuration management",
			],
			supportedPatterns: [
				"after X minutes/hours/days",
				"every X minutes/hours/days/weeks/months",
				"every day until X date",
				"every week for X months",
			],
			supportedChains: [11155111, 31, 545, 646], // Sepolia, Rootstock, Flow EVM, Flow Cadence
		};

		return res.json({
			success: true,
			data: status,
		} as ApiResponse);
	} catch (error) {
		console.error("Failed to get auto-scheduling status", { error });
		return res.status(500).json({
			success: false,
			error: "Failed to get auto-scheduling status",
		} as ApiResponse);
	}
});

export default router;

