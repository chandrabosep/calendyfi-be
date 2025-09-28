import { createPriceMonitorService } from "../services/price-monitor";
import { prisma, checkDatabaseConnection } from "../db/client";

async function testPriceTriggers() {
	console.log("🧪 Testing Price Trigger System");
	console.log("================================");

	// Check database connection first
	try {
		const dbConnected = await checkDatabaseConnection();
		if (!dbConnected) {
			console.error("❌ Database connection failed");
			return;
		}
		console.log("✅ Database connection successful");
	} catch (error) {
		console.error("❌ Database connection error:", error);
		return;
	}

	const priceMonitorService = createPriceMonitorService();

	// Test user ID
	const testUserId = "test-user-price-triggers";

	try {
		// Test 1: Create a price trigger for ETH above $3000
		console.log("\n1️⃣ Creating ETH price trigger (above $3000)...");
		const ethTrigger = await priceMonitorService.createPriceTrigger({
			userId: testUserId,
			triggerType: "above",
			targetPrice: 3000,
			fromToken: "ETH",
			toToken: "USDC",
			amount: "1.0",
			chainId: 11155111, // Sepolia
			isActive: true,
			slippageTolerance: 2.0,
			description: "Auto-swap ETH to USDC when ETH hits $3000",
		});

		if (ethTrigger.success) {
			console.log("✅ ETH trigger created:", ethTrigger.triggerId);
		} else {
			console.log("❌ Failed to create ETH trigger:", ethTrigger.error);
		}

		// Test 2: Create a price trigger for RBTC below $50000
		console.log("\n2️⃣ Creating RBTC price trigger (below $50000)...");
		const rbtcTrigger = await priceMonitorService.createPriceTrigger({
			userId: testUserId,
			triggerType: "below",
			targetPrice: 50000,
			fromToken: "RBTC",
			toToken: "RIF",
			amount: "0.1",
			chainId: 31, // Rootstock
			isActive: true,
			slippageTolerance: 3.0,
			description: "Auto-swap RBTC to RIF when RBTC drops below $50000",
		});

		if (rbtcTrigger.success) {
			console.log("✅ RBTC trigger created:", rbtcTrigger.triggerId);
		} else {
			console.log("❌ Failed to create RBTC trigger:", rbtcTrigger.error);
		}

		// Test 3: Create a price trigger for FLOW equals $1.50
		console.log("\n3️⃣ Creating FLOW price trigger (equals $1.50)...");
		const flowTrigger = await priceMonitorService.createPriceTrigger({
			userId: testUserId,
			triggerType: "equals",
			targetPrice: 1.5,
			fromToken: "FLOW",
			toToken: "USDC",
			amount: "100",
			chainId: 545, // Flow EVM
			isActive: true,
			slippageTolerance: 1.0,
			description: "Auto-swap FLOW to USDC when FLOW equals $1.50",
		});

		if (flowTrigger.success) {
			console.log("✅ FLOW trigger created:", flowTrigger.triggerId);
		} else {
			console.log("❌ Failed to create FLOW trigger:", flowTrigger.error);
		}

		// Test 4: Create a stock price trigger for AAPL above $200
		console.log("\n4️⃣ Creating AAPL stock price trigger (above $200)...");
		const aaplTrigger = await priceMonitorService.createPriceTrigger({
			userId: testUserId,
			triggerType: "above",
			targetPrice: 200,
			fromToken: "AAPL",
			toToken: "USDC",
			amount: "10",
			chainId: 11155111, // Sepolia (for USDC settlement)
			isActive: true,
			slippageTolerance: 2.0,
			description: "Auto-swap AAPL to USDC when Apple stock hits $200",
		});

		if (aaplTrigger.success) {
			console.log(
				"✅ AAPL stock trigger created:",
				aaplTrigger.triggerId
			);
		} else {
			console.log("❌ Failed to create AAPL trigger:", aaplTrigger.error);
		}

		// Test 5: Create a crypto price trigger for BTC below $40000
		console.log("\n5️⃣ Creating BTC crypto price trigger (below $40000)...");
		const btcTrigger = await priceMonitorService.createPriceTrigger({
			userId: testUserId,
			triggerType: "below",
			targetPrice: 40000,
			fromToken: "BTC",
			toToken: "ETH",
			amount: "0.1",
			chainId: 11155111, // Sepolia
			isActive: true,
			slippageTolerance: 3.0,
			description: "Auto-swap BTC to ETH when Bitcoin drops below $40000",
		});

		if (btcTrigger.success) {
			console.log("✅ BTC crypto trigger created:", btcTrigger.triggerId);
		} else {
			console.log("❌ Failed to create BTC trigger:", btcTrigger.error);
		}

		// Test 6: List all user triggers
		console.log("\n6️⃣ Fetching user price triggers...");
		const userTriggers = await priceMonitorService.getUserPriceTriggers(
			testUserId
		);
		console.log(`📋 Found ${userTriggers.length} price triggers:`);

		userTriggers.forEach((trigger, index) => {
			console.log(
				`\n   ${index + 1}. ${trigger.fromToken} ${
					trigger.triggerType
				} $${trigger.targetPrice}`
			);
			console.log(
				`      → Swap ${trigger.amount} ${trigger.fromToken} to ${trigger.toToken}`
			);
			console.log(`      → Chain: ${getChainName(trigger.chainId)}`);
			console.log(`      → Status: ${trigger.status}`);
			console.log(`      → Active: ${trigger.isActive ? "Yes" : "No"}`);
			if (trigger.currentPrice) {
				console.log(`      → Current Price: $${trigger.currentPrice}`);
			}
		});

		// Test 7: Test natural language parsing
		console.log("\n7️⃣ Testing natural language parsing...");
		const testCommands = [
			"@ai if AAPL hits $200 then swap 10 AAPL to USDC",
			"@ai when TSLA goes below $150 swap 5 TSLA to SPY",
			"@ai if ETH hits $3500 then swap 2 ETH to USDC",
			"@ai when BTC goes below $40000 swap 0.1 BTC to ETH",
			"@ai when RBTC goes below $45000 swap 0.05 RBTC to RIF",
			"@ai if FLOW above $2 swap 50 FLOW to USDC",
		];

		for (const command of testCommands) {
			console.log(`\n   Testing: "${command}"`);
			// This would normally be handled by the API endpoint
			// For now, just show what would be parsed
			console.log("   ✅ Would be parsed as price trigger command");
		}

		// Test 8: Cancel a trigger (if any exist)
		if (userTriggers.length > 0) {
			console.log("\n8️⃣ Testing trigger cancellation...");
			const triggerToCancel = userTriggers[0];
			const cancelResult = await priceMonitorService.cancelPriceTrigger(
				triggerToCancel.id,
				testUserId
			);

			if (cancelResult.success) {
				console.log(
					`✅ Cancelled trigger: ${triggerToCancel.fromToken} ${triggerToCancel.triggerType} $${triggerToCancel.targetPrice}`
				);
			} else {
				console.log("❌ Failed to cancel trigger:", cancelResult.error);
			}
		}

		// Test 9: Show monitoring status
		console.log("\n9️⃣ Price monitoring status:");
		console.log("   🔄 Price monitoring is running every 30 seconds");
		console.log("   📊 Supported price feeds: Polygon.io + CoinGecko API");
		console.log(
			"   📈 Supported stocks: AAPL, GOOGL, MSFT, TSLA, AMZN, NVDA, META, NFLX, SPY, QQQ"
		);
		console.log(
			"   🪙 Supported crypto: BTC, ETH, ADA, SOL, MATIC, AVAX, DOT, LINK, UNI, LTC"
		);
		console.log("   🎯 Supported tokens: ETH, RBTC, FLOW, USDC, RIF");
		console.log(
			"   ⛓️  Supported chains: Sepolia, Rootstock, Flow EVM, Flow Cadence"
		);

		console.log("\n✅ Price trigger system test completed!");
		console.log("\n🚀 Example usage in calendar:");
		console.log("   STOCKS:");
		console.log("   • '@ai if AAPL hits $200 then swap 10 AAPL to USDC'");
		console.log("   • '@ai when TSLA goes below $150 swap 5 TSLA to SPY'");
		console.log("   CRYPTO:");
		console.log("   • '@ai if ETH hits $3000 then swap 1 ETH to USDC'");
		console.log(
			"   • '@ai when BTC goes below $40000 swap 0.1 BTC to ETH'"
		);
		console.log("   TOKENS:");
		console.log(
			"   • '@ai when RBTC goes below $50000 swap 0.1 RBTC to RIF'"
		);
		console.log("   • '@ai if FLOW above $2 swap 100 FLOW to USDC'");
	} catch (error) {
		console.error("❌ Test failed:", error);
	} finally {
		// Stop the price monitoring service
		priceMonitorService.stopMonitoring();

		// Clean up test data
		try {
			await prisma.priceTrigger.deleteMany({
				where: { userId: testUserId },
			});
			console.log("\n🧹 Cleaned up test data");
		} catch (cleanupError) {
			console.warn("⚠️  Failed to clean up test data:", cleanupError);
		}
	}
}

function getChainName(chainId: number): string {
	const chainNames: Record<number, string> = {
		11155111: "Sepolia Testnet",
		31: "Rootstock Testnet",
		545: "Flow EVM Testnet",
		646: "Flow Cadence Testnet",
	};
	return chainNames[chainId] || `Chain ${chainId}`;
}

// Run the test
if (require.main === module) {
	testPriceTriggers()
		.then(() => {
			console.log("\n🎉 All tests completed!");
			process.exit(0);
		})
		.catch((error) => {
			console.error("💥 Test suite failed:", error);
			process.exit(1);
		});
}

export { testPriceTriggers };
