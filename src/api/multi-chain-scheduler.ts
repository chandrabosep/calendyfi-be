import { Router, Request, Response } from "express";
import { createMultiChainSchedulerService } from "../services/multi-chain-scheduler";
import { prisma } from "../db/client";
import { ApiResponse, MultiChainScheduleRequest } from "../types";
import Joi from "joi";
import rateLimit from "express-rate-limit";

const router = Router();
const multiChainScheduler = createMultiChainSchedulerService();

// Validation schemas
const multiChainScheduleSchema = Joi.object({
	recipient: Joi.string().required(),
	amount: Joi.string().required(),
	userId: Joi.string().required(),
	eventId: Joi.string().optional(),
	description: Joi.string().optional(),
	scheduleType: Joi.string().valid("once", "recurring", "custom").required(),
	chains: Joi.array().items(Joi.number().integer()).min(1).required(),
	// For one-time scheduling
	delaySeconds: Joi.number().integer().min(0).optional(),
	scheduledTime: Joi.date().optional(),
	// For recurring scheduling
	recurringSchedule: Joi.object({
		type: Joi.string()
			.valid("daily", "weekly", "monthly", "yearly")
			.required(),
		interval: Joi.number().integer().min(1).required(),
		startDate: Joi.date().required(),
		endDate: Joi.date().optional(),
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

const patternMultiChainSchema = Joi.object({
	recipient: Joi.string().required(),
	amount: Joi.string().required(),
	userId: Joi.string().required(),
	pattern: Joi.string().required(),
	chains: Joi.array().items(Joi.number().integer()).min(1).required(),
	eventId: Joi.string().optional(),
	description: Joi.string().optional(),
});

// Rate limiting
const scheduleLimit = rateLimit({
	windowMs: 1 * 60 * 1000, // 1 minute
	max: 3, // 3 multi-chain schedules per minute per IP
	message: {
		success: false,
		error: "Too many multi-chain scheduling requests. Please try again later.",
	} as ApiResponse,
});

/**
 * Schedule payment across multiple chains
 */
router.post(
	"/schedule-multi-chain",
	scheduleLimit,
	async (req: Request, res: Response) => {
		try {
			// Validate input
			const { error, value } = multiChainScheduleSchema.validate(
				req.body
			);
			if (error) {
				return res.status(400).json({
					success: false,
					error: "Invalid input data",
					details: error.details[0]?.message || "Validation error",
				} as ApiResponse);
			}

			const request: MultiChainScheduleRequest = value;

			console.info("Scheduling multi-chain payment", {
				chains: request.chains,
				scheduleType: request.scheduleType,
				recipient: request.recipient,
				amount: request.amount,
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

			// Validate chains are available
			const unavailableChains = request.chains.filter(
				(chainId: number) =>
					!multiChainScheduler.isChainAvailable(chainId)
			);

			if (unavailableChains.length > 0) {
				return res.status(400).json({
					success: false,
					error: `Chains not available for scheduling: ${unavailableChains.join(
						", "
					)}`,
				} as ApiResponse);
			}

			// Schedule the multi-chain payment
			const result = await multiChainScheduler.scheduleMultiChain(
				request
			);

			if (!result.success) {
				return res.status(500).json({
					success: false,
					error: "Failed to schedule multi-chain payment",
				} as ApiResponse);
			}

			// Store scheduled payments in database
			for (const [chainId, chainResult] of Object.entries(
				result.results
			)) {
				if (
					chainResult.success &&
					chainResult.scheduleIds &&
					chainResult.scheduledTimes &&
					chainResult.scheduleIds.length ===
						chainResult.scheduledTimes.length
				) {
					try {
						for (
							let i = 0;
							i < chainResult.scheduleIds.length;
							i++
						) {
							const scheduleId = chainResult.scheduleIds[i];
							const scheduledTime = chainResult.scheduledTimes[i];

							if (scheduleId && scheduledTime) {
								await prisma.flowScheduledPayment.create({
									data: {
										scheduleId,
										userId: request.userId,
										recipient: request.recipient,
										amount: request.amount,
										delaySeconds: Math.floor(
											(scheduledTime.getTime() -
												Date.now()) /
												1000
										),
										scheduledTime,
										method: "multi-chain",
										evmTxHash: chainResult.txHashes?.[i],
										eventId: request.eventId,
										description:
											request.description ||
											`Multi-chain schedule on chain ${chainId}`,
										executed: false,
									},
								});
							}
						}
					} catch (dbError) {
						console.warn(
							"Failed to store multi-chain scheduled payment in database",
							{
								chainId,
								dbError,
							}
						);
					}
				}
			}

			console.info("Multi-chain payment scheduled successfully", {
				totalSchedules: result.totalSchedules,
				successfulChains: result.successfulChains,
				failedChains: result.failedChains,
			});

			return res.json({
				success: true,
				data: {
					results: result.results,
					totalSchedules: result.totalSchedules,
					successfulChains: result.successfulChains,
					failedChains: result.failedChains,
					message: `Multi-chain payment scheduled successfully: ${result.successfulChains} chains, ${result.totalSchedules} total schedules`,
				},
			} as ApiResponse);
		} catch (error) {
			console.error("Failed to schedule multi-chain payment", { error });
			return res.status(500).json({
				success: false,
				error: "Failed to schedule multi-chain payment",
				details:
					error instanceof Error ? error.message : "Unknown error",
			} as ApiResponse);
		}
	}
);

/**
 * Schedule payment with pattern across multiple chains
 */
router.post(
	"/schedule-pattern-multi-chain",
	scheduleLimit,
	async (req: Request, res: Response) => {
		try {
			// Validate input
			const { error, value } = patternMultiChainSchema.validate(req.body);
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
				chains,
				eventId,
				description,
			} = value;

			console.info("Scheduling pattern payment across chains", {
				pattern,
				chains,
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

			// Validate chains are available
			const unavailableChains = chains.filter(
				(chainId: number) =>
					!multiChainScheduler.isChainAvailable(chainId)
			);

			if (unavailableChains.length > 0) {
				return res.status(400).json({
					success: false,
					error: `Chains not available for scheduling: ${unavailableChains.join(
						", "
					)}`,
				} as ApiResponse);
			}

			// Schedule the pattern payment across chains
			const result = await multiChainScheduler.schedulePatternMultiChain(
				recipient,
				amount,
				userId,
				pattern,
				chains
			);

			if (!result.success) {
				return res.status(500).json({
					success: false,
					error: "Failed to schedule pattern payment across chains",
				} as ApiResponse);
			}

			// Store scheduled payments in database
			for (const [chainId, chainResult] of Object.entries(
				result.results
			)) {
				if (
					chainResult.success &&
					chainResult.scheduleIds &&
					chainResult.scheduledTimes &&
					chainResult.scheduleIds.length ===
						chainResult.scheduledTimes.length
				) {
					try {
						for (
							let i = 0;
							i < chainResult.scheduleIds.length;
							i++
						) {
							const scheduleId = chainResult.scheduleIds[i];
							const scheduledTime = chainResult.scheduledTimes[i];

							if (scheduleId && scheduledTime) {
								await prisma.flowScheduledPayment.create({
									data: {
										scheduleId,
										userId,
										recipient,
										amount,
										delaySeconds: Math.floor(
											(scheduledTime.getTime() -
												Date.now()) /
												1000
										),
										scheduledTime,
										method: "multi-chain",
										evmTxHash: chainResult.txHashes?.[i],
										eventId,
										description:
											description ||
											`Pattern: ${pattern} on chain ${chainId}`,
										executed: false,
									},
								});
							}
						}
					} catch (dbError) {
						console.warn(
							"Failed to store pattern scheduled payment in database",
							{
								chainId,
								dbError,
							}
						);
					}
				}
			}

			console.info(
				"Pattern payment scheduled across chains successfully",
				{
					pattern,
					totalSchedules: result.totalSchedules,
					successfulChains: result.successfulChains,
					failedChains: result.failedChains,
				}
			);

			return res.json({
				success: true,
				data: {
					pattern,
					results: result.results,
					totalSchedules: result.totalSchedules,
					successfulChains: result.successfulChains,
					failedChains: result.failedChains,
					message: `Pattern payment scheduled across ${result.successfulChains} chains: ${pattern}`,
				},
			} as ApiResponse);
		} catch (error) {
			console.error("Failed to schedule pattern payment across chains", {
				error,
			});
			return res.status(500).json({
				success: false,
				error: "Failed to schedule pattern payment across chains",
				details:
					error instanceof Error ? error.message : "Unknown error",
			} as ApiResponse);
		}
	}
);

/**
 * Get available chains for scheduling
 */
router.get("/available-chains", async (req: Request, res: Response) => {
	try {
		const availableChains = multiChainScheduler.getAvailableChains();

		return res.json({
			success: true,
			data: {
				chains: availableChains.map((chain) => ({
					chainId: chain.chainId,
					name: chain.name,
					safeSupported: chain.safeSupported,
				})),
				message: "Available chains for multi-chain scheduling",
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Failed to get available chains", { error });
		return res.status(500).json({
			success: false,
			error: "Failed to get available chains",
		} as ApiResponse);
	}
});

/**
 * Check if a specific chain is available
 */
router.get("/check-chain/:chainId", async (req: Request, res: Response) => {
	try {
		const chainIdParam = req.params.chainId;
		if (!chainIdParam) {
			return res.status(400).json({
				success: false,
				error: "Chain ID parameter is required",
			} as ApiResponse);
		}

		const chainId = parseInt(chainIdParam);
		if (isNaN(chainId)) {
			return res.status(400).json({
				success: false,
				error: "Invalid chain ID",
			} as ApiResponse);
		}

		const isAvailable = multiChainScheduler.isChainAvailable(chainId);

		return res.json({
			success: true,
			data: {
				chainId,
				available: isAvailable,
				message: isAvailable
					? `Chain ${chainId} is available for scheduling`
					: `Chain ${chainId} is not available for scheduling`,
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Failed to check chain availability", { error });
		return res.status(500).json({
			success: false,
			error: "Failed to check chain availability",
		} as ApiResponse);
	}
});

export default router;
