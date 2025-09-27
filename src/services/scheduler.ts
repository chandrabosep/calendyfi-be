import { createTransactionExecutor } from "./transaction-executor";
import { createFlowSchedulerService } from "./flow-scheduler";

export class Scheduler {
	private transactionExecutor: ReturnType<typeof createTransactionExecutor>;
	private flowSchedulerService: ReturnType<typeof createFlowSchedulerService>;
	private intervalId: NodeJS.Timeout | null = null;
	private isRunning = false;

	constructor() {
		this.transactionExecutor = createTransactionExecutor();
		this.flowSchedulerService = createFlowSchedulerService();
	}

	/**
	 * Start the scheduler to process scheduled transactions
	 */
	start(intervalMinutes: number = 1): void {
		if (this.isRunning) {
			console.warn("Scheduler is already running");
			return;
		}

		console.info("Starting transaction scheduler", { intervalMinutes });

		this.isRunning = true;
		this.intervalId = setInterval(async () => {
			try {
				await this.processScheduledTransactions();
			} catch (error) {
				console.error("Error in scheduled transaction processing", {
					error,
				});
			}
		}, intervalMinutes * 60 * 1000);

		// Process immediately on start
		this.processScheduledTransactions().catch((error) => {
			console.error("Error in initial scheduled transaction processing", {
				error,
			});
		});
	}

	/**
	 * Stop the scheduler
	 */
	stop(): void {
		if (!this.isRunning) {
			console.warn("Scheduler is not running");
			return;
		}

		console.info("Stopping transaction scheduler");

		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}

		this.isRunning = false;
	}

	/**
	 * Process scheduled transactions
	 */
	private async processScheduledTransactions(): Promise<void> {
		try {
			console.info("Processing scheduled transactions");

			// Process regular EVM transactions
			const evmResult =
				await this.transactionExecutor.processScheduledTransactions();

			if (evmResult.processed > 0) {
				console.info("EVM scheduled transactions processed", {
					processed: evmResult.processed,
					successful: evmResult.successful,
					failed: evmResult.failed,
				});
			}

			// Process Flow scheduled payments
			const flowResult =
				await this.flowSchedulerService.processReadyPayments();

			if (flowResult.processed > 0) {
				console.info("Flow scheduled payments processed", {
					processed: flowResult.processed,
					successful: flowResult.successful,
					failed: flowResult.failed,
					errors:
						flowResult.errors.length > 0
							? flowResult.errors
							: undefined,
				});
			}

			// Log combined results
			const totalProcessed = evmResult.processed + flowResult.processed;
			const totalSuccessful =
				evmResult.successful + flowResult.successful;
			const totalFailed = evmResult.failed + flowResult.failed;

			if (totalProcessed > 0) {
				console.info("All scheduled transactions processed", {
					totalProcessed,
					totalSuccessful,
					totalFailed,
					evm: {
						processed: evmResult.processed,
						successful: evmResult.successful,
						failed: evmResult.failed,
					},
					flow: {
						processed: flowResult.processed,
						successful: flowResult.successful,
						failed: flowResult.failed,
					},
				});
			}
		} catch (error) {
			console.error("Failed to process scheduled transactions", {
				error,
			});
		}
	}

	/**
	 * Get scheduler status
	 */
	getStatus(): { isRunning: boolean; intervalMinutes?: number } {
		return {
			isRunning: this.isRunning,
			intervalMinutes: this.isRunning ? 1 : undefined, // Default interval
		};
	}
}

// Global scheduler instance
let globalScheduler: Scheduler | null = null;

export function getScheduler(): Scheduler {
	if (!globalScheduler) {
		globalScheduler = new Scheduler();
	}
	return globalScheduler;
}

export function startScheduler(intervalMinutes: number = 1): void {
	const scheduler = getScheduler();
	scheduler.start(intervalMinutes);
}

export function stopScheduler(): void {
	if (globalScheduler) {
		globalScheduler.stop();
	}
}
