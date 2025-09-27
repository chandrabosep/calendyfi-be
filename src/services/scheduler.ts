import { createTransactionExecutor } from "./transaction-executor";

export class Scheduler {
	private transactionExecutor: ReturnType<typeof createTransactionExecutor>;
	private intervalId: NodeJS.Timeout | null = null;
	private isRunning = false;

	constructor() {
		this.transactionExecutor = createTransactionExecutor();
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

			const result =
				await this.transactionExecutor.processScheduledTransactions();

			if (result.processed > 0) {
				console.info("Scheduled transactions processed", {
					processed: result.processed,
					successful: result.successful,
					failed: result.failed,
				});
			}
		} catch (error) {
			console.error("Failed to process scheduled transactions", { error });
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
