import dotenv from "dotenv";

// Load environment variables
dotenv.config();

console.log("🔍 Environment Variable Debug");
console.log("============================");

console.log(
	"process.env.POLYGON_API_KEY:",
	process.env.POLYGON_API_KEY
		? `${process.env.POLYGON_API_KEY.substring(0, 8)}...`
		: "undefined"
);
console.log("Length:", process.env.POLYGON_API_KEY?.length || 0);

// Test direct API call
async function testDirectCall() {
	const apiKey = process.env.POLYGON_API_KEY;
	if (!apiKey) {
		console.log("❌ No API key found");
		return;
	}

	try {
		const url = `https://api.polygon.io/v2/aggs/ticker/AAPL/prev?apikey=${apiKey}`;
		console.log("🌐 Testing URL:", url.replace(apiKey, "HIDDEN"));

		const response = await fetch(url);
		const data = await response.json();

		console.log("📊 Response status:", response.status);
		console.log("📊 Response data:", JSON.stringify(data, null, 2));
	} catch (error) {
		console.error("❌ Error:", error);
	}
}

testDirectCall();
