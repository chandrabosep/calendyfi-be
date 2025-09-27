import { FlowSchedulerService } from "../services/flow-scheduler";

async function testEVMScheduler() {
	console.log("🧪 Testing EVM Scheduler with mock data...\n");

	// Create the scheduler service
	const scheduler = new FlowSchedulerService();

	// Mock payment request
	const mockPaymentRequest = {
		recipient: "0x1234567890123456789012345678901234567890", // Mock recipient address
		amount: "1.0", // 1 FLOW token
		delaySeconds: 60, // 1 minute delay
		userId: "test-user-123",
	};

	console.log("📝 Mock Payment Request:", mockPaymentRequest);

	try {
		// Test 1: Schedule a payment
		console.log("\n1️⃣ Testing schedulePayment...");
		const scheduleResult = await scheduler.schedulePayment(
			mockPaymentRequest
		);

		if (scheduleResult.success) {
			console.log("✅ Payment scheduled successfully!");
			console.log("   Schedule ID:", scheduleResult.scheduleId);
			console.log("   EVM TX Hash:", scheduleResult.evmTxHash);
			console.log("   Cadence TX ID:", scheduleResult.cadenceTxId);
		} else {
			console.log("❌ Failed to schedule payment:", scheduleResult.error);
		}

		// Test 2: Get all scheduled payments
		console.log("\n2️⃣ Testing getAllScheduledPayments...");
		const allPaymentsResult = await scheduler.getAllScheduledPayments();

		if (allPaymentsResult.success && allPaymentsResult.payments) {
			console.log(
				"✅ Retrieved scheduled payments:",
				allPaymentsResult.payments.length
			);
			allPaymentsResult.payments.forEach((payment, index) => {
				console.log(`   Payment ${index + 1}:`, {
					id: payment.id,
					recipient: payment.recipient,
					amount: payment.amount,
					executed: payment.executed,
					scheduledTime: payment.scheduledTime.toISOString(),
				});
			});
		} else {
			console.log("❌ Failed to get payments:", allPaymentsResult.error);
		}

		// Test 3: Get payments for specific recipient
		console.log("\n3️⃣ Testing getScheduledPaymentsForRecipient...");
		const recipientPaymentsResult =
			await scheduler.getScheduledPaymentsForRecipient(
				mockPaymentRequest.recipient
			);

		if (
			recipientPaymentsResult.success &&
			recipientPaymentsResult.payments
		) {
			console.log(
				"✅ Retrieved payments for recipient:",
				recipientPaymentsResult.payments.length
			);
		} else {
			console.log(
				"❌ Failed to get recipient payments:",
				recipientPaymentsResult.error
			);
		}

		// Test 4: Check if payment is ready (should be false since we just scheduled it)
		if (scheduleResult.success && scheduleResult.scheduleId) {
			console.log("\n4️⃣ Testing isPaymentReadyForExecution...");
			const readinessResult = await scheduler.isPaymentReadyForExecution(
				scheduleResult.scheduleId
			);

			if (readinessResult.ready !== undefined) {
				console.log("✅ Payment readiness check:", {
					ready: readinessResult.ready,
					timeRemaining: readinessResult.timeRemaining,
				});
			} else {
				console.log(
					"❌ Failed to check payment readiness:",
					readinessResult.error
				);
			}
		}

		// Test 5: Get specific payment by ID
		if (scheduleResult.success && scheduleResult.scheduleId) {
			console.log("\n5️⃣ Testing getScheduledPaymentById...");
			const paymentResult = await scheduler.getScheduledPaymentById(
				scheduleResult.scheduleId
			);

			if (paymentResult.success && paymentResult.payment) {
				console.log("✅ Retrieved specific payment:", {
					id: paymentResult.payment.id,
					recipient: paymentResult.payment.recipient,
					amount: paymentResult.payment.amount,
					executed: paymentResult.payment.executed,
				});
			} else {
				console.log(
					"❌ Failed to get specific payment:",
					paymentResult.error
				);
			}
		}

		console.log("\n🎉 EVM Scheduler test completed!");
	} catch (error) {
		console.error("💥 Test failed with error:", error);
	}
}

// Run the test
testEVMScheduler().catch(console.error);
