import { createFlowSchedulerService } from "../services/flow-scheduler";
import { config } from "../config";

/**
 * Test script for Flow Scheduler integration
 * This script tests the basic functionality of the Flow scheduler
 */
async function testFlowScheduler() {
	console.log("🚀 Testing Flow Scheduler Integration");
	console.log("=====================================");

	const flowScheduler = createFlowSchedulerService();

	// Test 1: Check Flow configuration
	console.log("\n1. Testing Flow Configuration");
	console.log(
		"Chains configured:",
		config.chains.map((c) => ({ chainId: c.chainId, name: c.name }))
	);

	const flowEvmChain = config.chains.find((chain) => chain.chainId === 545);
	const flowCadenceChain = config.chains.find(
		(chain) => chain.chainId === 646
	);

	console.log("Flow EVM chain configured:", !!flowEvmChain);
	console.log("Flow Cadence chain configured:", !!flowCadenceChain);

	// Test 2: Get all scheduled payments (read-only test)
	console.log("\n2. Testing Cadence Contract Read Operations");
	try {
		const result = await flowScheduler.getAllScheduledPayments();
		console.log("✅ Successfully connected to Cadence contract");
		console.log("Scheduled payments found:", result.payments?.length || 0);

		if (result.success && result.payments && result.payments.length > 0) {
			console.log("Sample payment:", result.payments[0]);
		}
	} catch (error) {
		console.log("❌ Failed to connect to Cadence contract:", error);
	}

	// Test 3: Test EVM contract read operations (if available)
	console.log("\n3. Testing EVM Contract Read Operations");
	try {
		// Test getting schedules for a dummy address
		const dummyAddress = "0x1234567890123456789012345678901234567890";
		const result = await flowScheduler.getScheduledPaymentsForRecipient(
			dummyAddress
		);
		console.log("✅ Successfully connected to EVM contract");
		console.log(
			"Schedules for dummy address:",
			result.scheduleIds?.length || 0
		);
	} catch (error) {
		console.log("❌ Failed to connect to EVM contract:", error);
	}

	// Test 4: Test scheduling (only if environment allows)
	console.log("\n4. Testing Payment Scheduling");
	const testScheduling = process.env.TEST_FLOW_SCHEDULING === "true";

	if (testScheduling) {
		console.log(
			"⚠️  TEST_FLOW_SCHEDULING is enabled - attempting to schedule test payment"
		);

		try {
			const testPayment = {
				recipient: "0x1234567890123456789012345678901234567890",
				amount: "0.001", // Small test amount
				delaySeconds: 60, // 1 minute delay
				userId: "test-user-id",
			};

			console.log("Scheduling test payment:", testPayment);
			const result = await flowScheduler.schedulePaymentViaEVM(
				testPayment
			);

			if (result.success) {
				console.log("✅ Test payment scheduled successfully");
				console.log("Schedule ID:", result.scheduleId);
				console.log("EVM Tx Hash:", result.evmTxHash);
				console.log("Cadence Tx ID:", result.cadenceTxId);
			} else {
				console.log(
					"❌ Failed to schedule test payment:",
					result.error
				);
			}
		} catch (error) {
			console.log("❌ Error during test scheduling:", error);
		}
	} else {
		console.log(
			"⏭️  Skipping scheduling test (set TEST_FLOW_SCHEDULING=true to enable)"
		);
	}

	// Test 5: Test processing ready payments
	console.log("\n5. Testing Payment Processing");
	try {
		const result = await flowScheduler.processReadyPayments();
		console.log("✅ Payment processing test completed");
		console.log("Processed:", result.processed);
		console.log("Successful:", result.successful);
		console.log("Failed:", result.failed);

		if (result.errors.length > 0) {
			console.log("Errors:", result.errors);
		}
	} catch (error) {
		console.log("❌ Failed to test payment processing:", error);
	}

	console.log("\n🏁 Flow Scheduler Integration Test Complete");
	console.log("==========================================");
}

// Run the test if this script is executed directly
if (require.main === module) {
	testFlowScheduler()
		.then(() => {
			console.log("\n✅ All tests completed");
			process.exit(0);
		})
		.catch((error) => {
			console.error("\n❌ Test execution failed:", error);
			process.exit(1);
		});
}

export { testFlowScheduler };
