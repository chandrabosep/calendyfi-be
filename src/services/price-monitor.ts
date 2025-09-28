import { ethers } from "ethers";
import { prisma } from "../db/client";
import { createMultiChainSchedulerService } from "./multi-chain-scheduler";
import { createFlowSchedulerService } from "./flow-scheduler";
import { TokenService } from "./token-service";
import {
	createPolygonPriceFeedService,
	PolygonPriceData,
} from "./polygon-price-feed";

export interface PriceTrigger {
	id: string;
	userId: string;
	triggerType: "above" | "below" | "equals";
	targetPrice: number;
	currentPrice?: number;
	fromToken: string;
	toToken: string;
	amount: string;
	chainId: number;
	isActive: boolean;
	createdAt: Date;
	triggeredAt?: Date;
	executedAt?: Date;
	status: "pending" | "triggered" | "executed" | "failed" | "cancelled";
	slippageTolerance?: number; // Percentage
	gasLimit?: string;
	description?: string;
	calendarEventId?: string;
}

export interface PriceAlert {
	id: string;
	userId: string;
	token: string;
	chainId: number;
	triggerType: "above" | "below";
	targetPrice: number;
	isActive: boolean;
	notificationMethod: "email" | "calendar" | "both";
	message?: string;
}

export interface PriceData {
	token: string;
	chainId?: number;
	price: number;
	timestamp: Date;
	source: string;
	change?: number;
	changePercent?: number;
	marketStatus?: "open" | "closed" | "extended";
	assetType?: "stock" | "crypto" | "token";
}

export class PriceMonitorService {
	private multiChainScheduler = createMultiChainSchedulerService();
	private flowScheduler = createFlowSchedulerService();
	private tokenService = new TokenService();
	private polygonService = createPolygonPriceFeedService();
	private monitoringInterval: NodeJS.Timeout | null = null;
	private priceFeeds: Map<string, PriceData> = new Map();

	// Price feed APIs (you can add more providers)
	private readonly PRICE_APIS = {
		coingecko: "https://api.coingecko.com/api/v3/simple/price",
		chainlink: "https://api.chain.link/v1/feeds", // If available
	};

	constructor() {
		this.startPriceMonitoring();
	}

	/**
	 * Create a price trigger for conditional swaps
	 */
	async createPriceTrigger(
		trigger: Omit<PriceTrigger, "id" | "createdAt" | "status">
	): Promise<{
		success: boolean;
		triggerId?: string;
		error?: string;
	}> {
		try {
			console.info("Creating price trigger", {
				userId: trigger.userId,
				triggerType: trigger.triggerType,
				targetPrice: trigger.targetPrice,
				fromToken: trigger.fromToken,
				toToken: trigger.toToken,
			});

			// Validate tokens - for stocks and crypto, we don't need chain validation
			const assetType = this.determineAssetType(trigger.fromToken);

			if (assetType === "token") {
				// Only validate blockchain tokens against specific chains
				const fromTokenInfo = this.tokenService.getTokenInfo(
					trigger.fromToken,
					trigger.chainId
				);
				const toTokenInfo = this.tokenService.getTokenInfo(
					trigger.toToken,
					trigger.chainId
				);

				if (!fromTokenInfo || !toTokenInfo) {
					return {
						success: false,
						error: "Invalid token pair for the specified chain",
					};
				}
			} else {
				// For stocks and crypto, just validate that we support them
				const supportedStocks = [
					"AAPL",
					"GOOGL",
					"MSFT",
					"TSLA",
					"AMZN",
					"NVDA",
					"META",
					"NFLX",
					"SPY",
					"QQQ",
				];
				const supportedCrypto = [
					"BTC",
					"ETH",
					"ADA",
					"SOL",
					"MATIC",
					"AVAX",
					"DOT",
					"LINK",
					"UNI",
					"LTC",
				];
				const supportedTokens = ["USDC", "USDT", "DAI"]; // Common settlement tokens

				const allSupported = [
					...supportedStocks,
					...supportedCrypto,
					...supportedTokens,
				];

				if (
					!allSupported.includes(trigger.fromToken.toUpperCase()) ||
					!allSupported.includes(trigger.toToken.toUpperCase())
				) {
					return {
						success: false,
						error: `Unsupported asset pair: ${trigger.fromToken} -> ${trigger.toToken}`,
					};
				}
			}

			// Get current price for validation
			const currentPrice = await this.getCurrentPrice(
				trigger.fromToken,
				trigger.chainId
			);
			if (!currentPrice) {
				return {
					success: false,
					error: "Unable to fetch current price for token",
				};
			}

			// Store in database
			const priceTrigger = await prisma.priceTrigger.create({
				data: {
					userId: trigger.userId,
					triggerType: trigger.triggerType,
					targetPrice: trigger.targetPrice,
					currentPrice: currentPrice,
					fromToken: trigger.fromToken,
					toToken: trigger.toToken,
					amount: trigger.amount,
					chainId: trigger.chainId,
					isActive: trigger.isActive,
					slippageTolerance: trigger.slippageTolerance || 2.0, // Default 2%
					gasLimit: trigger.gasLimit,
					description: trigger.description,
					calendarEventId: trigger.calendarEventId,
					status: "pending",
				},
			});

			console.info("Price trigger created successfully", {
				triggerId: priceTrigger.id,
				currentPrice,
				targetPrice: trigger.targetPrice,
			});

			return {
				success: true,
				triggerId: priceTrigger.id,
			};
		} catch (error) {
			console.error("Failed to create price trigger", { error });
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	/**
	 * Start monitoring prices and checking triggers
	 */
	private startPriceMonitoring() {
		if (this.monitoringInterval) {
			clearInterval(this.monitoringInterval);
		}

		// Check prices every 30 seconds
		this.monitoringInterval = setInterval(async () => {
			await this.checkPriceTriggers();
		}, 30000);

		console.info("Price monitoring started - checking every 30 seconds");
	}

	/**
	 * Check all active price triggers
	 */
	private async checkPriceTriggers() {
		try {
			const activeTriggers = await prisma.priceTrigger.findMany({
				where: {
					isActive: true,
					status: "pending",
				},
			});

			console.info(
				`Checking ${activeTriggers.length} active price triggers`
			);

			for (const trigger of activeTriggers) {
				await this.evaluateTrigger(trigger);
			}
		} catch (error) {
			console.error("Error checking price triggers", { error });
		}
	}

	/**
	 * Evaluate a single price trigger
	 */
	private async evaluateTrigger(trigger: any) {
		try {
			const currentPrice = await this.getCurrentPrice(
				trigger.fromToken,
				trigger.chainId
			);
			if (!currentPrice) {
				console.warn("Unable to fetch current price for trigger", {
					triggerId: trigger.id,
					token: trigger.fromToken,
				});
				return;
			}

			// Update current price in database
			await prisma.priceTrigger.update({
				where: { id: trigger.id },
				data: { currentPrice },
			});

			// Check if trigger condition is met
			let shouldTrigger = false;
			switch (trigger.triggerType) {
				case "above":
					shouldTrigger = currentPrice >= trigger.targetPrice;
					break;
				case "below":
					shouldTrigger = currentPrice <= trigger.targetPrice;
					break;
				case "equals":
					// Allow 1% tolerance for "equals"
					const tolerance = trigger.targetPrice * 0.01;
					shouldTrigger =
						Math.abs(currentPrice - trigger.targetPrice) <=
						tolerance;
					break;
			}

			if (shouldTrigger) {
				console.info("Price trigger condition met!", {
					triggerId: trigger.id,
					triggerType: trigger.triggerType,
					targetPrice: trigger.targetPrice,
					currentPrice,
					fromToken: trigger.fromToken,
					toToken: trigger.toToken,
				});

				await this.executeTrigger(trigger, currentPrice);
			}
		} catch (error) {
			console.error("Error evaluating trigger", {
				triggerId: trigger.id,
				error,
			});
		}
	}

	/**
	 * Execute a triggered swap
	 */
	private async executeTrigger(trigger: any, currentPrice: number) {
		try {
			// Mark as triggered
			await prisma.priceTrigger.update({
				where: { id: trigger.id },
				data: {
					status: "triggered",
					triggeredAt: new Date(),
				},
			});

			// Execute the swap based on chain
			let result;
			if (trigger.chainId === 545 || trigger.chainId === 646) {
				// Flow chains
				result = await this.flowScheduler.scheduleWithPattern(
					"immediate_swap", // Special recipient for swaps
					trigger.amount,
					trigger.userId,
					"immediate", // Execute immediately
					"evm"
				);
			} else {
				// Other EVM chains
				result =
					await this.multiChainScheduler.schedulePatternMultiChain(
						"immediate_swap",
						trigger.amount,
						trigger.userId,
						"immediate",
						[trigger.chainId]
					);
			}

			if (result.success) {
				await prisma.priceTrigger.update({
					where: { id: trigger.id },
					data: {
						status: "executed",
						executedAt: new Date(),
						isActive: false, // Deactivate after execution
					},
				});

				console.info("Price trigger executed successfully", {
					triggerId: trigger.id,
					executionPrice: currentPrice,
				});

				// Create calendar event for the executed swap
				if (trigger.calendarEventId) {
					await this.createSwapCalendarEvent(trigger, currentPrice);
				}
			} else {
				await prisma.priceTrigger.update({
					where: { id: trigger.id },
					data: {
						status: "failed",
					},
				});

				console.error("Failed to execute price trigger", {
					triggerId: trigger.id,
					error: (result as any).error || "Unknown error",
				});
			}
		} catch (error) {
			console.error("Error executing trigger", {
				triggerId: trigger.id,
				error,
			});

			await prisma.priceTrigger.update({
				where: { id: trigger.id },
				data: {
					status: "failed",
				},
			});
		}
	}

	/**
	 * Get current price for a token/stock/crypto
	 */
	private async getCurrentPrice(
		token: string,
		chainId?: number
	): Promise<number | null> {
		try {
			const upperToken = token.toUpperCase();

			// Try Polygon.io first for stocks and major crypto
			if (this.polygonService.isConfigured()) {
				try {
					const polygonPrice = await this.polygonService.getPrice(
						upperToken
					);
					if (polygonPrice) {
						console.info(
							`📊 Got price from Polygon.io: ${upperToken} = $${polygonPrice.price}`
						);

						// Cache the full price data
						const priceData: PriceData = {
							token: upperToken,
							chainId,
							price: polygonPrice.price,
							timestamp: polygonPrice.timestamp,
							source: "polygon",
							change: polygonPrice.change,
							changePercent: polygonPrice.changePercent,
							marketStatus: polygonPrice.marketStatus,
							assetType: this.determineAssetType(upperToken),
						};

						this.priceFeeds.set(
							`${upperToken}-${chainId || 0}`,
							priceData
						);
						return polygonPrice.price;
					}
				} catch (polygonError) {
					console.warn(
						`Polygon.io failed for ${upperToken}, falling back to CoinGecko:`,
						polygonError
					);
				}
			}

			// Fallback to CoinGecko for blockchain tokens
			return await this.getCoinGeckoPrice(upperToken, chainId);
		} catch (error) {
			console.error("Error fetching price", { token, chainId, error });
			return null;
		}
	}

	/**
	 * Get price from CoinGecko (fallback)
	 */
	private async getCoinGeckoPrice(
		token: string,
		chainId?: number
	): Promise<number | null> {
		try {
			// Map tokens to CoinGecko IDs
			const tokenMap: Record<string, string> = {
				ETH: "ethereum",
				ETHEREUM: "ethereum",
				BTC: "bitcoin",
				BITCOIN: "bitcoin",
				RBTC: "rootstock",
				FLOW: "flow",
				USDC: "usd-coin",
				USDT: "tether",
				DAI: "dai",
				RIF: "rif-token",
				ADA: "cardano",
				CARDANO: "cardano",
				SOL: "solana",
				SOLANA: "solana",
				MATIC: "matic-network",
				POLYGON: "matic-network",
				AVAX: "avalanche-2",
				AVALANCHE: "avalanche-2",
				DOT: "polkadot",
				POLKADOT: "polkadot",
				LINK: "chainlink",
				CHAINLINK: "chainlink",
				UNI: "uniswap",
				UNISWAP: "uniswap",
				LTC: "litecoin",
				LITECOIN: "litecoin",
			};

			const coinGeckoId = tokenMap[token.toUpperCase()];
			if (!coinGeckoId) {
				console.warn(
					"Token not supported for CoinGecko price monitoring",
					{ token }
				);
				return null;
			}

			const response = await fetch(
				`${this.PRICE_APIS.coingecko}?ids=${coinGeckoId}&vs_currencies=usd&include_24hr_change=true`
			);

			if (!response.ok) {
				throw new Error(`CoinGecko API error: ${response.statusText}`);
			}

			const data = (await response.json()) as any;
			const tokenData = data[coinGeckoId];
			const price = tokenData?.usd;
			const change24h = tokenData?.usd_24h_change;

			if (typeof price === "number") {
				console.info(
					`🦎 Got price from CoinGecko: ${token} = $${price}`
				);

				// Cache the price data
				const priceData: PriceData = {
					token: token.toUpperCase(),
					chainId,
					price,
					timestamp: new Date(),
					source: "coingecko",
					changePercent: change24h || undefined,
					assetType: "crypto",
				};

				this.priceFeeds.set(
					`${token.toUpperCase()}-${chainId || 0}`,
					priceData
				);
				return price;
			}

			return null;
		} catch (error) {
			console.error("Error fetching CoinGecko price", {
				token,
				chainId,
				error,
			});
			return null;
		}
	}

	/**
	 * Determine asset type based on token symbol
	 */
	private determineAssetType(token: string): "stock" | "crypto" | "token" {
		const stockSymbols = [
			"AAPL",
			"GOOGL",
			"MSFT",
			"TSLA",
			"AMZN",
			"NVDA",
			"META",
			"NFLX",
			"SPY",
			"QQQ",
		];
		const cryptoSymbols = [
			"BTC",
			"ETH",
			"ADA",
			"SOL",
			"MATIC",
			"AVAX",
			"DOT",
			"LINK",
			"UNI",
			"LTC",
		];

		if (stockSymbols.includes(token.toUpperCase())) {
			return "stock";
		} else if (cryptoSymbols.includes(token.toUpperCase())) {
			return "crypto";
		} else {
			return "token";
		}
	}

	/**
	 * Create calendar event for executed swap
	 */
	private async createSwapCalendarEvent(
		trigger: any,
		executionPrice: number
	) {
		try {
			const eventTitle = `🔄 Auto-Swap Executed: ${trigger.amount} ${trigger.fromToken} → ${trigger.toToken}`;
			const eventDescription = `
Price trigger executed!
• Trigger: ${trigger.fromToken} ${trigger.triggerType} $${trigger.targetPrice}
• Execution Price: $${executionPrice}
• Amount: ${trigger.amount} ${trigger.fromToken}
• Target Token: ${trigger.toToken}
• Chain: ${this.getChainName(trigger.chainId)}
• Executed: ${new Date().toLocaleString()}
			`.trim();

			// Here you would integrate with your calendar service
			// For now, just log the event
			console.info("Swap calendar event created", {
				title: eventTitle,
				description: eventDescription,
			});
		} catch (error) {
			console.error("Error creating swap calendar event", { error });
		}
	}

	/**
	 * Get user's active price triggers
	 */
	async getUserPriceTriggers(userId: string): Promise<PriceTrigger[]> {
		try {
			const triggers = await prisma.priceTrigger.findMany({
				where: { userId },
				orderBy: { createdAt: "desc" },
			});

			return triggers.map((trigger) => ({
				id: trigger.id,
				userId: trigger.userId,
				triggerType: trigger.triggerType as
					| "above"
					| "below"
					| "equals",
				targetPrice: trigger.targetPrice,
				currentPrice: trigger.currentPrice || undefined,
				fromToken: trigger.fromToken,
				toToken: trigger.toToken,
				amount: trigger.amount,
				chainId: trigger.chainId,
				isActive: trigger.isActive,
				createdAt: trigger.createdAt,
				triggeredAt: trigger.triggeredAt || undefined,
				executedAt: trigger.executedAt || undefined,
				status: trigger.status as
					| "pending"
					| "triggered"
					| "executed"
					| "failed"
					| "cancelled",
				slippageTolerance: trigger.slippageTolerance || undefined,
				gasLimit: trigger.gasLimit || undefined,
				description: trigger.description || undefined,
				calendarEventId: trigger.calendarEventId || undefined,
			}));
		} catch (error) {
			console.error("Error fetching user price triggers", {
				userId,
				error,
			});
			return [];
		}
	}

	/**
	 * Cancel a price trigger
	 */
	async cancelPriceTrigger(
		triggerId: string,
		userId: string
	): Promise<{
		success: boolean;
		error?: string;
	}> {
		try {
			const trigger = await prisma.priceTrigger.findFirst({
				where: {
					id: triggerId,
					userId,
				},
			});

			if (!trigger) {
				return {
					success: false,
					error: "Price trigger not found",
				};
			}

			await prisma.priceTrigger.update({
				where: { id: triggerId },
				data: {
					isActive: false,
					status: "cancelled",
				},
			});

			return { success: true };
		} catch (error) {
			console.error("Error cancelling price trigger", {
				triggerId,
				error,
			});
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	/**
	 * Get chain name by ID
	 */
	private getChainName(chainId: number): string {
		const chainNames: Record<number, string> = {
			11155111: "Sepolia",
			31: "Rootstock",
			545: "Flow EVM",
			646: "Flow Cadence",
		};
		return chainNames[chainId] || `Chain ${chainId}`;
	}

	/**
	 * Stop price monitoring
	 */
	stopMonitoring() {
		if (this.monitoringInterval) {
			clearInterval(this.monitoringInterval);
			this.monitoringInterval = null;
			console.info("Price monitoring stopped");
		}
	}
}

export function createPriceMonitorService(): PriceMonitorService {
	return new PriceMonitorService();
}
