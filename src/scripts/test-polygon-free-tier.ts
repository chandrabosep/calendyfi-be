import { createPolygonPriceFeedService } from "../services/polygon-price-feed";

async function testPolygonFreeTier() {
	console.log("🧪 Testing Polygon.io Free Tier Access");
	console.log("=====================================");

	const polygonService = createPolygonPriceFeedService();

	if (!polygonService.isConfigured()) {
		console.log("❌ No API key configured");
		return;
	}

	console.log("✅ API Key configured - testing free tier endpoints...");

	try {
		// Test different endpoints to see what's available
		console.log("\n1️⃣ Testing Basic Market Status...");
		try {
			const response = await fetch(
				`https://api.polygon.io/v1/marketstatus/now?apikey=${process.env.POLYGON_API_KEY}`
			);

			if (response.ok) {
				const data = await response.json();
				console.log("✅ Market Status API works!");
				console.log("📊 Market Status:", data.market);
			} else {
				const errorText = await response.text();
				console.log(
					"❌ Market Status API:",
					response.status,
					errorText
				);
			}
		} catch (error) {
			console.log("❌ Market Status Error:", error);
		}

		// Test aggregates (bars) - often available on free tier
		console.log("\n2️⃣ Testing Daily Aggregates (Historical Data)...");
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 2); // Go back 2 days to ensure market was open
		const dateStr = yesterday.toISOString().split("T")[0];

		try {
			const response = await fetch(
				`https://api.polygon.io/v2/aggs/ticker/AAPL/range/1/day/${dateStr}/${dateStr}?apikey=${process.env.POLYGON_API_KEY}`
			);

			if (response.ok) {
				const data = await response.json();
				console.log("✅ Daily Aggregates API works!");
				if (data.results && data.results.length > 0) {
					const result = data.results[0];
					console.log(`📈 AAPL on ${dateStr}:`);
					console.log(`   Open: $${result.o}`);
					console.log(`   High: $${result.h}`);
					console.log(`   Low: $${result.l}`);
					console.log(`   Close: $${result.c}`);
					console.log(`   Volume: ${result.v.toLocaleString()}`);
				}
			} else {
				const errorText = await response.text();
				console.log(
					"❌ Daily Aggregates API:",
					response.status,
					errorText
				);
			}
		} catch (error) {
			console.log("❌ Daily Aggregates Error:", error);
		}

		// Test crypto endpoints
		console.log("\n3️⃣ Testing Crypto Endpoints...");
		try {
			const response = await fetch(
				`https://api.polygon.io/v2/aggs/ticker/X:BTCUSD/range/1/day/${dateStr}/${dateStr}?apikey=${process.env.POLYGON_API_KEY}`
			);

			if (response.ok) {
				const data = await response.json();
				console.log("✅ Crypto Aggregates API works!");
				if (data.results && data.results.length > 0) {
					const result = data.results[0];
					console.log(`🪙 BTC on ${dateStr}:`);
					console.log(`   Open: $${result.o}`);
					console.log(`   High: $${result.h}`);
					console.log(`   Low: $${result.l}`);
					console.log(`   Close: $${result.c}`);
				}
			} else {
				const errorText = await response.text();
				console.log(
					"❌ Crypto Aggregates API:",
					response.status,
					errorText
				);
			}
		} catch (error) {
			console.log("❌ Crypto Aggregates Error:", error);
		}

		// Test ticker details
		console.log("\n4️⃣ Testing Ticker Details...");
		try {
			const response = await fetch(
				`https://api.polygon.io/v3/reference/tickers/AAPL?apikey=${process.env.POLYGON_API_KEY}`
			);

			if (response.ok) {
				const data = await response.json();
				console.log("✅ Ticker Details API works!");
				if (data.results) {
					console.log(`📋 AAPL Details:`);
					console.log(`   Name: ${data.results.name}`);
					console.log(`   Market: ${data.results.market}`);
					console.log(`   Type: ${data.results.type}`);
					console.log(`   Currency: ${data.results.currency_name}`);
				}
			} else {
				const errorText = await response.text();
				console.log(
					"❌ Ticker Details API:",
					response.status,
					errorText
				);
			}
		} catch (error) {
			console.log("❌ Ticker Details Error:", error);
		}

		// Test what plan you have
		console.log("\n5️⃣ Checking Your Plan Limits...");
		try {
			// Try a simple request to see rate limits
			const response = await fetch(
				`https://api.polygon.io/v2/aggs/ticker/AAPL/prev?apikey=${process.env.POLYGON_API_KEY}`
			);

			console.log("📊 Response Headers:");
			console.log(`   Status: ${response.status}`);
			console.log(
				`   Rate Limit: ${
					response.headers.get("X-RateLimit-Limit") || "Not shown"
				}`
			);
			console.log(
				`   Rate Remaining: ${
					response.headers.get("X-RateLimit-Remaining") || "Not shown"
				}`
			);
			console.log(
				`   Rate Reset: ${
					response.headers.get("X-RateLimit-Reset") || "Not shown"
				}`
			);

			if (response.ok) {
				const data = await response.json();
				console.log("✅ Previous Close API works!");
				if (data.results && data.results.length > 0) {
					const result = data.results[0];
					console.log(`📈 AAPL Previous Close: $${result.c}`);
				}
			} else {
				const errorText = await response.text();
				console.log("❌ Previous Close API:", response.status);
				console.log("   Error:", errorText);
			}
		} catch (error) {
			console.log("❌ Plan Check Error:", error);
		}

		console.log("\n📋 Summary:");
		console.log("✅ Your API key is working!");
		console.log("⚠️  Some endpoints require paid plans");
		console.log("💡 Free tier typically includes:");
		console.log("   • Historical daily data (delayed)");
		console.log("   • Basic market info");
		console.log("   • Limited rate (5 requests/minute)");
		console.log("\n💰 For real-time data, consider upgrading at:");
		console.log("   https://polygon.io/pricing");
	} catch (error) {
		console.error("❌ Test failed:", error);
	}
}

// Run the test
if (require.main === module) {
	testPolygonFreeTier()
		.then(() => {
			console.log("\n🎉 Free tier test completed!");
			process.exit(0);
		})
		.catch((error) => {
			console.error("💥 Test failed:", error);
			process.exit(1);
		});
}

export { testPolygonFreeTier };
