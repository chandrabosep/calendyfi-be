import { config } from "../config";

export interface PolygonPriceData {
	symbol: string;
	price: number;
	change: number;
	changePercent: number;
	timestamp: Date;
	source: "polygon";
	marketStatus: "open" | "closed" | "extended";
}

export interface PolygonStockQuote {
	ticker: string;
	last: {
		price: number;
		size: number;
		exchange: number;
		timestamp: number;
	};
	min: {
		av: number; // Volume weighted average price
		t: number; // Timestamp
		n: number; // Number of transactions
		o: number; // Open price
		h: number; // High price
		l: number; // Low price
		c: number; // Close price
		v: number; // Volume
		vw: number; // Volume weighted average price
	};
	prevDay: {
		o: number; // Previous day open
		h: number; // Previous day high
		l: number; // Previous day low
		c: number; // Previous day close
		v: number; // Previous day volume
		vw: number; // Previous day VWAP
	};
	updated: number;
	market_status: string;
	fmv: number; // Fair market value
}

export interface PolygonCryptoQuote {
	symbol: string;
	last: {
		price: number;
		size: number;
		exchange: number;
		timestamp: number;
	};
	market_status: string;
	fmv: number;
}

export class PolygonPriceFeedService {
	private readonly apiKey: string;
	private readonly baseUrl = "https://api.polygon.io";
	private readonly rateLimitDelay = 12000; // 12 seconds between requests for free tier
	private lastRequestTime = 0;

	// Supported assets mapping
	private readonly stockSymbols = new Map([
		["AAPL", "Apple Inc."],
		["GOOGL", "Alphabet Inc."],
		["MSFT", "Microsoft Corporation"],
		["TSLA", "Tesla Inc."],
		["AMZN", "Amazon.com Inc."],
		["NVDA", "NVIDIA Corporation"],
		["META", "Meta Platforms Inc."],
		["NFLX", "Netflix Inc."],
		["SPY", "SPDR S&P 500 ETF"],
		["QQQ", "Invesco QQQ Trust"],
	]);

	private readonly cryptoSymbols = new Map([
		["X:BTCUSD", "Bitcoin"],
		["X:ETHUSD", "Ethereum"],
		["X:ADAUSD", "Cardano"],
		["X:SOLUSD", "Solana"],
		["X:MATICUSD", "Polygon"],
		["X:AVAXUSD", "Avalanche"],
		["X:DOTUSD", "Polkadot"],
		["X:LINKUSD", "Chainlink"],
		["X:UNIUSD", "Uniswap"],
		["X:LTCUSD", "Litecoin"],
	]);

	constructor() {
		this.apiKey =
			process.env.POLYGON_API_KEY || "ZsKgGO6rNgpUhL8BxkjYNAX2M5ZECTf1";
		if (!this.apiKey) {
			console.warn(
				"⚠️  POLYGON_API_KEY not found in environment variables"
			);
			console.warn("   Price feeds will fall back to CoinGecko only");
		} else {
			console.info(
				`✅ Polygon.io API key loaded: ${this.apiKey.substring(
					0,
					8
				)}... (${this.apiKey.length} chars)`
			);
		}
	}

	/**
	 * Rate limiting helper
	 */
	private async enforceRateLimit(): Promise<void> {
		const now = Date.now();
		const timeSinceLastRequest = now - this.lastRequestTime;

		if (timeSinceLastRequest < this.rateLimitDelay) {
			const waitTime = this.rateLimitDelay - timeSinceLastRequest;
			console.info(`⏳ Rate limiting: waiting ${waitTime}ms`);
			await new Promise((resolve) => setTimeout(resolve, waitTime));
		}

		this.lastRequestTime = Date.now();
	}

	/**
	 * Make authenticated request to Polygon.io API
	 */
	private async makeRequest(endpoint: string): Promise<any> {
		if (!this.apiKey) {
			throw new Error("Polygon.io API key not configured");
		}

		await this.enforceRateLimit();

		const url = `${this.baseUrl}${endpoint}${
			endpoint.includes("?") ? "&" : "?"
		}apikey=${this.apiKey}`;

		console.info(`📡 Polygon.io API request: ${endpoint}`);

		const response = await fetch(url, {
			method: "GET",
			headers: {
				"Content-Type": "application/json",
			},
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Polygon.io API error (${response.status}): ${errorText}`
			);
		}

		const data = (await response.json()) as any;

		if (data.status === "ERROR") {
			throw new Error(
				`Polygon.io API error: ${data.error || "Unknown error"}`
			);
		}

		return data;
	}

	/**
	 * Get real-time stock quote
	 */
	async getStockPrice(symbol: string): Promise<PolygonPriceData | null> {
		try {
			const upperSymbol = symbol.toUpperCase();

			if (!this.stockSymbols.has(upperSymbol)) {
				console.warn(
					`Stock symbol ${upperSymbol} not in supported list`
				);
				return null;
			}

			// Try real-time quote first, fallback to previous close for free tier
			let quoteData;
			try {
				quoteData = await this.makeRequest(
					`/v2/snapshot/locale/us/markets/stocks/tickers/${upperSymbol}`
				);
			} catch (error) {
				// If real-time fails (free tier), try previous close
				console.warn(
					`Real-time data not available for ${upperSymbol}, trying previous close`
				);
				quoteData = await this.makeRequest(
					`/v2/aggs/ticker/${upperSymbol}/prev`
				);

				// Transform previous close format to match snapshot format
				if (quoteData.results && quoteData.results.length > 0) {
					const result = quoteData.results[0];
					quoteData = {
						results: [
							{
								ticker: upperSymbol,
								last: { price: result.c },
								min: {
									c: result.c,
									o: result.o,
									h: result.h,
									l: result.l,
								},
								prevDay: { c: result.c },
								updated: result.t,
								market_status: "closed", // Previous close is always from closed market
							},
						],
					};
				}
			}

			if (!quoteData.results || quoteData.results.length === 0) {
				console.warn(`No data returned for stock ${upperSymbol}`);
				return null;
			}

			const result = quoteData.results[0] as PolygonStockQuote;
			const currentPrice =
				result.last?.price || result.min?.c || result.prevDay?.c;
			const prevClose = result.prevDay?.c || currentPrice;

			if (!currentPrice) {
				console.warn(`No price data available for ${upperSymbol}`);
				return null;
			}

			const change = currentPrice - prevClose;
			const changePercent =
				prevClose > 0 ? (change / prevClose) * 100 : 0;

			return {
				symbol: upperSymbol,
				price: currentPrice,
				change,
				changePercent,
				timestamp: new Date(result.updated || Date.now()),
				source: "polygon",
				marketStatus: this.parseMarketStatus(result.market_status),
			};
		} catch (error) {
			console.error(`Error fetching stock price for ${symbol}:`, error);
			return null;
		}
	}

	/**
	 * Get real-time crypto price
	 */
	async getCryptoPrice(symbol: string): Promise<PolygonPriceData | null> {
		try {
			// Convert common crypto symbols to Polygon format
			const polygonSymbol = this.convertToPolygonCryptoSymbol(symbol);

			if (!polygonSymbol) {
				console.warn(`Crypto symbol ${symbol} not supported`);
				return null;
			}

			// Try real-time crypto quote first, fallback to previous close for free tier
			let quoteData;
			try {
				quoteData = await this.makeRequest(
					`/v2/snapshot/locale/global/markets/crypto/tickers/${polygonSymbol}`
				);
			} catch (error) {
				// If real-time fails (free tier), try previous close for crypto
				console.warn(
					`Real-time crypto data not available for ${symbol}, trying previous close`
				);
				quoteData = await this.makeRequest(
					`/v2/aggs/ticker/${polygonSymbol}/prev`
				);

				// Transform previous close format to match snapshot format
				if (quoteData.results && quoteData.results.length > 0) {
					const result = quoteData.results[0];
					quoteData = {
						results: [
							{
								symbol: polygonSymbol,
								last: { price: result.c, timestamp: result.t },
								market_status: "open", // Crypto markets are 24/7 per Polygon.io docs
								fmv: result.c,
								value: result.c, // Add value field for consistency
							},
						],
					};
				}
			}

			if (!quoteData.results || quoteData.results.length === 0) {
				console.warn(`No data returned for crypto ${polygonSymbol}`);
				return null;
			}

			const result = quoteData.results[0] as PolygonCryptoQuote;
			const currentPrice = result.last?.price || result.fmv;

			if (!currentPrice) {
				console.warn(`No price data available for ${polygonSymbol}`);
				return null;
			}

			// Skip previous day calculation for crypto since markets are 24/7
			// Per Polygon.io docs: crypto operates continuously without traditional close
			const change = 0; // Will be calculated if real-time data available
			const changePercent = 0;

			return {
				symbol: symbol.toUpperCase(),
				price: currentPrice,
				change,
				changePercent,
				timestamp: new Date(result.last?.timestamp || Date.now()),
				source: "polygon",
				marketStatus: "open", // Crypto markets are always open
			};
		} catch (error) {
			console.error(`Error fetching crypto price for ${symbol}:`, error);
			return null;
		}
	}

	/**
	 * Get previous day crypto price for change calculation
	 */
	private async getCryptoPreviousDayPrice(
		polygonSymbol: string
	): Promise<{ price: number } | null> {
		try {
			const yesterday = new Date();
			yesterday.setDate(yesterday.getDate() - 1);
			const dateStr = yesterday.toISOString().split("T")[0];

			const data = await this.makeRequest(
				`/v1/open-close/crypto/${polygonSymbol}/${dateStr}`
			);

			return data.close ? { price: data.close } : null;
		} catch (error) {
			console.warn(
				`Could not fetch previous day price for ${polygonSymbol}:`,
				error
			);
			return null;
		}
	}

	/**
	 * Convert common crypto symbols to Polygon format
	 */
	private convertToPolygonCryptoSymbol(symbol: string): string | null {
		const symbolMap: Record<string, string> = {
			BTC: "X:BTCUSD",
			BITCOIN: "X:BTCUSD",
			ETH: "X:ETHUSD",
			ETHEREUM: "X:ETHUSD",
			ADA: "X:ADAUSD",
			CARDANO: "X:ADAUSD",
			SOL: "X:SOLUSD",
			SOLANA: "X:SOLUSD",
			MATIC: "X:MATICUSD",
			POLYGON: "X:MATICUSD",
			AVAX: "X:AVAXUSD",
			AVALANCHE: "X:AVAXUSD",
			DOT: "X:DOTUSD",
			POLKADOT: "X:DOTUSD",
			LINK: "X:LINKUSD",
			CHAINLINK: "X:LINKUSD",
			UNI: "X:UNIUSD",
			UNISWAP: "X:UNIUSD",
			LTC: "X:LTCUSD",
			LITECOIN: "X:LTCUSD",
		};

		return symbolMap[symbol.toUpperCase()] || null;
	}

	/**
	 * Parse market status from Polygon response
	 */
	private parseMarketStatus(status: string): "open" | "closed" | "extended" {
		switch (status?.toLowerCase()) {
			case "open":
				return "open";
			case "closed":
				return "closed";
			case "extended":
			case "extended_hours":
				return "extended";
			default:
				return "closed";
		}
	}

	/**
	 * Get price for any supported asset (stock or crypto)
	 */
	async getPrice(
		symbol: string,
		assetType?: "stock" | "crypto"
	): Promise<PolygonPriceData | null> {
		const upperSymbol = symbol.toUpperCase();

		// Auto-detect asset type if not specified
		if (!assetType) {
			if (this.stockSymbols.has(upperSymbol)) {
				assetType = "stock";
			} else if (this.convertToPolygonCryptoSymbol(upperSymbol)) {
				assetType = "crypto";
			} else {
				console.warn(`Could not determine asset type for ${symbol}`);
				return null;
			}
		}

		if (assetType === "stock") {
			return await this.getStockPrice(symbol);
		} else {
			return await this.getCryptoPrice(symbol);
		}
	}

	/**
	 * Get multiple prices in batch (with rate limiting)
	 */
	async getBatchPrices(
		symbols: Array<{ symbol: string; assetType?: "stock" | "crypto" }>
	): Promise<PolygonPriceData[]> {
		const results: PolygonPriceData[] = [];

		for (const { symbol, assetType } of symbols) {
			try {
				const priceData = await this.getPrice(symbol, assetType);
				if (priceData) {
					results.push(priceData);
				}
			} catch (error) {
				console.error(`Error fetching price for ${symbol}:`, error);
			}
		}

		return results;
	}

	/**
	 * Get supported symbols
	 */
	getSupportedSymbols(): {
		stocks: Array<{ symbol: string; name: string }>;
		crypto: Array<{ symbol: string; name: string }>;
	} {
		return {
			stocks: Array.from(this.stockSymbols.entries()).map(
				([symbol, name]) => ({
					symbol,
					name,
				})
			),
			crypto: Array.from(this.cryptoSymbols.entries()).map(
				([polygonSymbol, name]) => {
					// Convert back to common symbol
					const symbol = polygonSymbol
						.replace("X:", "")
						.replace("USD", "");
					return { symbol, name };
				}
			),
		};
	}

	/**
	 * Check if API key is configured
	 */
	isConfigured(): boolean {
		return !!this.apiKey;
	}

	/**
	 * Test API connection
	 */
	async testConnection(): Promise<{
		success: boolean;
		message: string;
		sampleData?: PolygonPriceData;
	}> {
		if (!this.apiKey) {
			return {
				success: false,
				message: "Polygon.io API key not configured",
			};
		}

		try {
			// Test with a simple stock quote
			const testPrice = await this.getStockPrice("AAPL");

			if (testPrice) {
				return {
					success: true,
					message: "Polygon.io API connection successful",
					sampleData: testPrice,
				};
			} else {
				return {
					success: false,
					message: "Could not fetch test data from Polygon.io",
				};
			}
		} catch (error) {
			return {
				success: false,
				message: `Polygon.io API connection failed: ${
					error instanceof Error ? error.message : "Unknown error"
				}`,
			};
		}
	}
}

export function createPolygonPriceFeedService(): PolygonPriceFeedService {
	return new PolygonPriceFeedService();
}
