import { createPolygonPriceFeedService } from "../services/polygon-price-feed";

async function testPolygonAPI() {
	console.log("🧪 Testing Polygon.io API Data Retrieval");
	console.log("=========================================");

	const polygonService = createPolygonPriceFeedService();

	// Check if API key is configured
	console.log(`🔑 API Key configured: ${polygonService.isConfigured()}`);

	if (!polygonService.isConfigured()) {
		console.log("⚠️  No Polygon.io API key found in environment variables");
		console.log(
			"   Add POLYGON_API_KEY to your .env file to test API functionality"
		);
		console.log("   Sign up at: https://polygon.io/pricing");
		return;
	}

	try {
		// Test 1: API Connection Test
		console.log("\n1️⃣ Testing API Connection...");
		const connectionTest = await polygonService.testConnection();

		if (connectionTest.success) {
			console.log("✅ API Connection successful!");
			if (connectionTest.sampleData) {
				console.log("📊 Sample data:", {
					symbol: connectionTest.sampleData.symbol,
					price: `$${connectionTest.sampleData.price}`,
					change: connectionTest.sampleData.change
						? `${
								connectionTest.sampleData.change > 0 ? "+" : ""
						  }${connectionTest.sampleData.change.toFixed(2)}`
						: "N/A",
					changePercent: connectionTest.sampleData.changePercent
						? `${
								connectionTest.sampleData.changePercent > 0
									? "+"
									: ""
						  }${connectionTest.sampleData.changePercent.toFixed(
								2
						  )}%`
						: "N/A",
					marketStatus: connectionTest.sampleData.marketStatus,
					source: connectionTest.sampleData.source,
				});
			}
		} else {
			console.log("❌ API Connection failed:", connectionTest.message);
			return;
		}

		// Test 2: Stock Price Retrieval
		console.log("\n2️⃣ Testing Stock Price Retrieval...");
		const stockSymbols = ["AAPL", "GOOGL", "MSFT", "TSLA"];

		for (const symbol of stockSymbols) {
			try {
				console.log(`\n   📈 Fetching ${symbol}...`);
				const stockPrice = await polygonService.getStockPrice(symbol);

				if (stockPrice) {
					console.log(`   ✅ ${symbol}: $${stockPrice.price}`);
					console.log(
						`      Change: ${
							stockPrice.change
								? `${
										stockPrice.change > 0 ? "+" : ""
								  }$${stockPrice.change.toFixed(2)}`
								: "N/A"
						}`
					);
					console.log(
						`      Change %: ${
							stockPrice.changePercent
								? `${
										stockPrice.changePercent > 0 ? "+" : ""
								  }${stockPrice.changePercent.toFixed(2)}%`
								: "N/A"
						}`
					);
					console.log(`      Market: ${stockPrice.marketStatus}`);
					console.log(
						`      Updated: ${stockPrice.timestamp.toLocaleString()}`
					);
				} else {
					console.log(`   ❌ ${symbol}: No data available`);
				}
			} catch (error) {
				console.log(
					`   ❌ ${symbol}: Error - ${
						error instanceof Error ? error.message : "Unknown error"
					}`
				);
			}
		}

		// Test 3: Crypto Price Retrieval
		console.log("\n3️⃣ Testing Crypto Price Retrieval...");
		const cryptoSymbols = ["BTC", "ETH", "ADA", "SOL"];

		for (const symbol of cryptoSymbols) {
			try {
				console.log(`\n   🪙 Fetching ${symbol}...`);
				const cryptoPrice = await polygonService.getCryptoPrice(symbol);

				if (cryptoPrice) {
					console.log(`   ✅ ${symbol}: $${cryptoPrice.price}`);
					console.log(
						`      Change: ${
							cryptoPrice.change
								? `${
										cryptoPrice.change > 0 ? "+" : ""
								  }$${cryptoPrice.change.toFixed(2)}`
								: "N/A"
						}`
					);
					console.log(
						`      Change %: ${
							cryptoPrice.changePercent
								? `${
										cryptoPrice.changePercent > 0 ? "+" : ""
								  }${cryptoPrice.changePercent.toFixed(2)}%`
								: "N/A"
						}`
					);
					console.log(`      Market: ${cryptoPrice.marketStatus}`);
					console.log(
						`      Updated: ${cryptoPrice.timestamp.toLocaleString()}`
					);
				} else {
					console.log(`   ❌ ${symbol}: No data available`);
				}
			} catch (error) {
				console.log(
					`   ❌ ${symbol}: Error - ${
						error instanceof Error ? error.message : "Unknown error"
					}`
				);
			}
		}

		// Test 4: Auto-Detection Test
		console.log("\n4️⃣ Testing Auto-Detection...");
		const mixedSymbols = ["AAPL", "BTC", "GOOGL", "ETH"];

		for (const symbol of mixedSymbols) {
			try {
				console.log(`\n   🔍 Auto-detecting ${symbol}...`);
				const price = await polygonService.getPrice(symbol);

				if (price) {
					console.log(
						`   ✅ ${symbol}: $${price.price} (detected as ${price.symbol})`
					);
					console.log(`      Market: ${price.marketStatus}`);
				} else {
					console.log(
						`   ❌ ${symbol}: Could not detect or fetch price`
					);
				}
			} catch (error) {
				console.log(
					`   ❌ ${symbol}: Error - ${
						error instanceof Error ? error.message : "Unknown error"
					}`
				);
			}
		}

		// Test 5: Batch Price Retrieval
		console.log("\n5️⃣ Testing Batch Price Retrieval...");
		const batchSymbols = [
			{ symbol: "AAPL", assetType: "stock" as const },
			{ symbol: "BTC", assetType: "crypto" as const },
			{ symbol: "TSLA", assetType: "stock" as const },
			{ symbol: "ETH", assetType: "crypto" as const },
		];

		try {
			console.log("   📦 Fetching batch prices...");
			const batchResults = await polygonService.getBatchPrices(
				batchSymbols
			);

			console.log(`   ✅ Retrieved ${batchResults.length} prices:`);
			batchResults.forEach((result) => {
				console.log(
					`      ${result.symbol}: $${result.price} (${result.marketStatus})`
				);
			});
		} catch (error) {
			console.log(
				`   ❌ Batch fetch error: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}

		// Test 6: Supported Symbols
		console.log("\n6️⃣ Supported Symbols...");
		const supportedSymbols = polygonService.getSupportedSymbols();

		console.log(`   📈 Stocks (${supportedSymbols.stocks.length}):`);
		supportedSymbols.stocks.forEach((stock) => {
			console.log(`      ${stock.symbol}: ${stock.name}`);
		});

		console.log(`   🪙 Crypto (${supportedSymbols.crypto.length}):`);
		supportedSymbols.crypto.forEach((crypto) => {
			console.log(`      ${crypto.symbol}: ${crypto.name}`);
		});

		console.log("\n✅ Polygon.io API test completed successfully!");
	} catch (error) {
		console.error("❌ Test failed:", error);
	}
}

// Run the test
if (require.main === module) {
	testPolygonAPI()
		.then(() => {
			console.log("\n🎉 All API tests completed!");
			process.exit(0);
		})
		.catch((error) => {
			console.error("💥 API test suite failed:", error);
			process.exit(1);
		});
}

export { testPolygonAPI };
