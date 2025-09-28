import { Router, Request, Response } from "express";
import { createPriceMonitorService } from "../services/price-monitor";
import { ApiResponse } from "../types";
import Joi from "joi";
import rateLimit from "express-rate-limit";

const router = Router();
const priceMonitorService = createPriceMonitorService();

// Validation schemas
const createTriggerSchema = Joi.object({
	triggerType: Joi.string().valid("above", "below", "equals").required(),
	targetPrice: Joi.number().positive().required(),
	fromToken: Joi.string().required(),
	toToken: Joi.string().required(),
	amount: Joi.string().required(),
	chainId: Joi.number().integer().positive().required(),
	slippageTolerance: Joi.number().min(0).max(50).optional(), // 0-50%
	gasLimit: Joi.string().optional(),
	description: Joi.string().max(500).optional(),
	calendarEventId: Joi.string().optional(),
});

const cancelTriggerSchema = Joi.object({
	triggerId: Joi.string().required(),
});

// Rate limiting for price trigger operations
const triggerLimit = rateLimit({
	windowMs: 5 * 60 * 1000, // 5 minutes
	max: 10, // 10 triggers per 5 minutes per IP
	message: {
		success: false,
		error: "Too many price trigger requests. Please try again later.",
	} as ApiResponse,
});

/**
 * Create a new price trigger
 */
router.post("/create", triggerLimit, async (req: Request, res: Response) => {
	try {
		// Validate input
		const { error, value } = createTriggerSchema.validate(req.body);
		if (error) {
			return res.status(400).json({
				success: false,
				error: "Invalid input data",
				details: error.details[0]?.message || "Validation error",
			} as ApiResponse);
		}

		const userId = req.headers["user-id"] as string;
		if (!userId) {
			return res.status(401).json({
				success: false,
				error: "User ID required",
			} as ApiResponse);
		}

		const {
			triggerType,
			targetPrice,
			fromToken,
			toToken,
			amount,
			chainId,
			slippageTolerance,
			gasLimit,
			description,
			calendarEventId,
		} = value;

		console.info("Creating price trigger", {
			userId,
			triggerType,
			targetPrice,
			fromToken,
			toToken,
			chainId,
		});

		const result = await priceMonitorService.createPriceTrigger({
			userId,
			triggerType,
			targetPrice,
			fromToken,
			toToken,
			amount,
			chainId,
			isActive: true,
			slippageTolerance,
			gasLimit,
			description,
			calendarEventId,
		});

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error || "Failed to create price trigger",
			} as ApiResponse);
		}

		return res.json({
			success: true,
			data: {
				triggerId: result.triggerId,
				message: "Price trigger created successfully",
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Failed to create price trigger", { error });
		return res.status(500).json({
			success: false,
			error: "Internal server error",
		} as ApiResponse);
	}
});

/**
 * Get user's price triggers
 */
router.get("/list", async (req: Request, res: Response) => {
	try {
		const userId = req.headers["user-id"] as string;
		if (!userId) {
			return res.status(401).json({
				success: false,
				error: "User ID required",
			} as ApiResponse);
		}

		const triggers = await priceMonitorService.getUserPriceTriggers(userId);

		return res.json({
			success: true,
			data: {
				triggers,
				count: triggers.length,
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Failed to fetch price triggers", { error });
		return res.status(500).json({
			success: false,
			error: "Failed to fetch price triggers",
		} as ApiResponse);
	}
});

/**
 * Cancel a price trigger
 */
router.post("/cancel", async (req: Request, res: Response) => {
	try {
		// Validate input
		const { error, value } = cancelTriggerSchema.validate(req.body);
		if (error) {
			return res.status(400).json({
				success: false,
				error: "Invalid input data",
				details: error.details[0]?.message || "Validation error",
			} as ApiResponse);
		}

		const userId = req.headers["user-id"] as string;
		if (!userId) {
			return res.status(401).json({
				success: false,
				error: "User ID required",
			} as ApiResponse);
		}

		const { triggerId } = value;

		const result = await priceMonitorService.cancelPriceTrigger(
			triggerId,
			userId
		);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error || "Failed to cancel price trigger",
			} as ApiResponse);
		}

		return res.json({
			success: true,
			data: {
				message: "Price trigger cancelled successfully",
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Failed to cancel price trigger", { error });
		return res.status(500).json({
			success: false,
			error: "Internal server error",
		} as ApiResponse);
	}
});

/**
 * Get price trigger status and statistics
 */
router.get("/status", async (req: Request, res: Response) => {
	try {
		const userId = req.headers["user-id"] as string;
		if (!userId) {
			return res.status(401).json({
				success: false,
				error: "User ID required",
			} as ApiResponse);
		}

		const triggers = await priceMonitorService.getUserPriceTriggers(userId);

		const stats = {
			total: triggers.length,
			active: triggers.filter((t) => t.isActive && t.status === "pending")
				.length,
			triggered: triggers.filter((t) => t.status === "triggered").length,
			executed: triggers.filter((t) => t.status === "executed").length,
			failed: triggers.filter((t) => t.status === "failed").length,
			cancelled: triggers.filter((t) => t.status === "cancelled").length,
		};

		const supportedAssets = {
			stocks: [
				{ symbol: "AAPL", name: "Apple Inc." },
				{ symbol: "GOOGL", name: "Alphabet Inc." },
				{ symbol: "MSFT", name: "Microsoft Corporation" },
				{ symbol: "TSLA", name: "Tesla Inc." },
				{ symbol: "AMZN", name: "Amazon.com Inc." },
				{ symbol: "NVDA", name: "NVIDIA Corporation" },
				{ symbol: "META", name: "Meta Platforms Inc." },
				{ symbol: "NFLX", name: "Netflix Inc." },
				{ symbol: "SPY", name: "SPDR S&P 500 ETF" },
				{ symbol: "QQQ", name: "Invesco QQQ Trust" },
			],
			crypto: [
				{ symbol: "BTC", name: "Bitcoin" },
				{ symbol: "ETH", name: "Ethereum" },
				{ symbol: "ADA", name: "Cardano" },
				{ symbol: "SOL", name: "Solana" },
				{ symbol: "MATIC", name: "Polygon" },
				{ symbol: "AVAX", name: "Avalanche" },
				{ symbol: "DOT", name: "Polkadot" },
				{ symbol: "LINK", name: "Chainlink" },
				{ symbol: "UNI", name: "Uniswap" },
				{ symbol: "LTC", name: "Litecoin" },
			],
			tokens: [
				{ symbol: "FLOW", name: "Flow", chains: [545, 646] },
				{ symbol: "USDC", name: "USD Coin", chains: [11155111, 31] },
				{ symbol: "RBTC", name: "Rootstock Bitcoin", chains: [31] },
				{ symbol: "RIF", name: "RIF Token", chains: [31] },
			],
		};

		return res.json({
			success: true,
			data: {
				service: "Price Monitor",
				status: "active",
				statistics: stats,
				supportedAssets,
				features: [
					"Real-time price monitoring",
					"Stock price triggers (via Polygon.io)",
					"Crypto price triggers (via Polygon.io + CoinGecko)",
					"Conditional swap execution",
					"Multi-chain support",
					"Calendar integration",
					"Slippage protection",
				],
				monitoringInterval: "30 seconds",
				dataSources: ["Polygon.io", "CoinGecko"],
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Failed to get price trigger status", { error });
		return res.status(500).json({
			success: false,
			error: "Failed to get status",
		} as ApiResponse);
	}
});

/**
 * Parse natural language price trigger from calendar
 */
router.post("/parse-calendar", async (req: Request, res: Response) => {
	try {
		const { eventText, userId } = req.body;

		if (!eventText || !userId) {
			return res.status(400).json({
				success: false,
				error: "Event text and user ID required",
			} as ApiResponse);
		}

		// Parse natural language like:
		// "@ai if ETH hits $3000 then swap 1 ETH to USDC"
		// "@ai when RBTC goes below $50000 swap 0.1 RBTC to RIF"

		const parsed = parseNaturalLanguageTrigger(eventText);

		if (!parsed.success) {
			return res.status(400).json({
				success: false,
				error: parsed.error || "Unable to parse price trigger",
			} as ApiResponse);
		}

		return res.json({
			success: true,
			data: {
				parsed: parsed.trigger,
				suggestion: `Create price trigger: ${parsed.trigger?.fromToken} ${parsed.trigger?.triggerType} $${parsed.trigger?.targetPrice} → swap ${parsed.trigger?.amount} to ${parsed.trigger?.toToken}`,
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Failed to parse calendar price trigger", { error });
		return res.status(500).json({
			success: false,
			error: "Failed to parse price trigger",
		} as ApiResponse);
	}
});

/**
 * Parse natural language price trigger
 */
function parseNaturalLanguageTrigger(text: string): {
	success: boolean;
	trigger?: any;
	error?: string;
} {
	try {
		const normalizedText = text.toLowerCase().trim();

		// Pattern: "@ai if/when TOKEN hits/goes above/below $PRICE then swap AMOUNT TOKEN to TOKEN"
		const patterns = [
			/if\s+(\w+)\s+hits\s+\$?(\d+(?:\.\d+)?)\s+then\s+swap\s+(\d+(?:\.\d+)?)\s+(\w+)\s+to\s+(\w+)/,
			/when\s+(\w+)\s+goes\s+above\s+\$?(\d+(?:\.\d+)?)\s+swap\s+(\d+(?:\.\d+)?)\s+(\w+)\s+to\s+(\w+)/,
			/when\s+(\w+)\s+goes\s+below\s+\$?(\d+(?:\.\d+)?)\s+swap\s+(\d+(?:\.\d+)?)\s+(\w+)\s+to\s+(\w+)/,
			/if\s+(\w+)\s+above\s+\$?(\d+(?:\.\d+)?)\s+swap\s+(\d+(?:\.\d+)?)\s+(\w+)\s+to\s+(\w+)/,
			/if\s+(\w+)\s+below\s+\$?(\d+(?:\.\d+)?)\s+swap\s+(\d+(?:\.\d+)?)\s+(\w+)\s+to\s+(\w+)/,
		];

		for (const pattern of patterns) {
			const match = normalizedText.match(pattern);
			if (match) {
				const [
					,
					triggerToken,
					targetPrice,
					amount,
					fromToken,
					toToken,
				] = match;

				// Determine trigger type from text
				let triggerType: "above" | "below" | "equals" = "above";
				if (
					normalizedText.includes("below") ||
					normalizedText.includes("under")
				) {
					triggerType = "below";
				} else if (
					normalizedText.includes("hits") ||
					normalizedText.includes("equals")
				) {
					triggerType = "equals";
				}

				// Default to Sepolia for now (can be enhanced to detect chain)
				const chainId = 11155111;

				return {
					success: true,
					trigger: {
						triggerType,
						targetPrice: parseFloat(targetPrice),
						fromToken: fromToken.toUpperCase(),
						toToken: toToken.toUpperCase(),
						amount: amount,
						chainId,
						description: `Auto-parsed from: ${text}`,
					},
				};
			}
		}

		return {
			success: false,
			error: "Unable to parse price trigger format. Try: '@ai if ETH hits $3000 then swap 1 ETH to USDC'",
		};
	} catch (error) {
		return {
			success: false,
			error: "Failed to parse natural language trigger",
		};
	}
}

export default router;
