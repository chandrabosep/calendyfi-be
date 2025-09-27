import { ethers } from "ethers";
import { config } from "../config";

// Contract addresses from the frontend integration
const EVM_SCHEDULER_ADDRESS = "0x6baaD070bF8AB1932578157826CfB209BdB254a1";
const CADENCE_SCHEDULER_ADDRESS = "0x9f3e9372a21a4f15";

// EVM Contract ABI for scheduling - updated to match your contract
const EVM_SCHEDULER_ABI = [
	"function schedulePayment(address recipient, uint256 amount, uint256 delaySeconds) external returns (uint256)",
	"function executeSchedule(uint256 scheduleId) external",
	"function getSchedule(uint256 scheduleId) external view returns (tuple(uint256 id, address recipient, uint256 amount, uint256 delaySeconds, uint256 createdAt, bool executed, string cadenceTxId))",
	"function getSchedulesForRecipient(address recipient) external view returns (uint256[])",
	"function getCadenceSchedulerAddress() external pure returns (string)",
	"function nextScheduleId() external view returns (uint256)",
	"function owner() external view returns (address)",
	"function transferOwnership(address newOwner) external",
	"event CadenceScheduleTriggered(uint256 indexed scheduleId, address indexed recipient, uint256 amount, uint256 delaySeconds, string cadenceTxId)",
	"event ScheduleExecuted(uint256 indexed scheduleId, bool success)",
];

export interface ScheduledPayment {
	id: string;
	recipient: string;
	amount: string;
	delaySeconds: number;
	scheduledTime: Date;
	executed: boolean;
	sender?: string;
	cadenceTxId?: string;
	evmTxId?: string;
}

export interface SchedulePaymentRequest {
	recipient: string;
	amount: string; // Amount in FLOW tokens
	delaySeconds: number;
	userId: string;
}

export class FlowSchedulerService {
	private evmProvider: ethers.JsonRpcProvider | null = null;
	private evmContract: ethers.Contract | null = null;

	constructor() {
		this.initializeEVM();
	}

	/**
	 * Initialize EVM connection for Flow EVM
	 */
	private initializeEVM(): void {
		try {
			const flowEvmChain = config.chains.find(
				(chain) => chain.chainId === 545
			);
			if (!flowEvmChain) {
				console.warn("Flow EVM chain configuration not found");
				return;
			}

			this.evmProvider = new ethers.JsonRpcProvider(flowEvmChain.rpcUrl);

			// Create contract instance with a signer for write operations
			const signer = new ethers.Wallet(
				flowEvmChain.deployerPrivateKey,
				this.evmProvider
			);
			this.evmContract = new ethers.Contract(
				EVM_SCHEDULER_ADDRESS,
				EVM_SCHEDULER_ABI,
				signer
			);

			console.info("Flow EVM scheduler initialized", {
				contractAddress: EVM_SCHEDULER_ADDRESS,
				chainId: 545,
			});
		} catch (error) {
			console.error("Failed to initialize Flow EVM", { error });
		}
	}

	/**
	 * Schedule a payment via EVM contract (which triggers Cadence)
	 */
	async schedulePaymentViaEVM(request: SchedulePaymentRequest): Promise<{
		success: boolean;
		scheduleId?: string;
		evmTxHash?: string;
		cadenceTxId?: string;
		error?: string;
	}> {
		try {
			if (!this.evmContract) {
				return {
					success: false,
					error: "EVM contract not initialized",
				};
			}

			console.info("Scheduling payment via EVM", request);

			// Convert amount to wei (assuming FLOW token with 18 decimals)
			const amountWei = ethers.parseEther(request.amount);

			// Schedule payment on EVM
			const tx = await this.evmContract!.schedulePayment(
				request.recipient,
				amountWei,
				request.delaySeconds
			);

			console.info("EVM transaction sent", { txHash: tx.hash });

			// Wait for transaction confirmation
			const receipt = await tx.wait();

			// Find the CadenceScheduleTriggered event
			const event = receipt.logs.find((log: any) => {
				try {
					const parsed = this.evmContract?.interface.parseLog(log);
					return parsed?.name === "CadenceScheduleTriggered";
				} catch {
					return false;
				}
			});

			if (event && this.evmContract) {
				const parsed = this.evmContract.interface.parseLog(event);
				if (parsed && parsed.args) {
					const scheduleId = parsed.args.scheduleId.toString();
					const cadenceTxId = parsed.args.cadenceTxId;

					console.info("Payment scheduled successfully", {
						scheduleId,
						evmTxHash: tx.hash,
						cadenceTxId,
					});

					return {
						success: true,
						scheduleId,
						evmTxHash: tx.hash,
						cadenceTxId,
					};
				}
			}

			console.warn("CadenceScheduleTriggered event not found in receipt");
			return {
				success: true,
				evmTxHash: tx.hash,
			};
		} catch (error) {
			console.error("Failed to schedule payment via EVM", {
				error,
				request,
			});
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	/**
	 * Schedule a payment via EVM contract (recommended method)
	 */
	async schedulePayment(request: SchedulePaymentRequest): Promise<{
		success: boolean;
		scheduleId?: string;
		evmTxHash?: string;
		cadenceTxId?: string;
		error?: string;
	}> {
		return this.schedulePaymentViaEVM(request);
	}

	/**
	 * Get all scheduled payments from EVM contract
	 */
	async getAllScheduledPayments(): Promise<{
		success: boolean;
		payments?: ScheduledPayment[];
		error?: string;
	}> {
		try {
			if (!this.evmContract) {
				return {
					success: false,
					error: "EVM contract not initialized",
				};
			}

			// Get all schedule IDs by checking from 1 to nextScheduleId
			const nextId = await this.evmContract!.nextScheduleId();
			const payments: ScheduledPayment[] = [];

			for (let i = 1; i < nextId; i++) {
				try {
					const schedule = await this.evmContract!.getSchedule(i);
					if (schedule && schedule.id.toString() !== "0") {
						payments.push({
							id: schedule.id.toString(),
							recipient: schedule.recipient,
							amount: ethers.formatEther(schedule.amount),
							delaySeconds: parseInt(schedule.delaySeconds),
							scheduledTime: new Date(
								parseInt(schedule.createdAt) * 1000 +
									parseInt(schedule.delaySeconds) * 1000
							),
							executed: schedule.executed,
							cadenceTxId: schedule.cadenceTxId,
						});
					}
				} catch (error) {
					// Skip invalid schedule IDs
					continue;
				}
			}

			console.info("Retrieved scheduled payments from EVM", {
				count: payments.length,
			});

			return {
				success: true,
				payments,
			};
		} catch (error) {
			console.error("Failed to get scheduled payments from EVM", {
				error,
			});
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	/**
	 * Get scheduled payments for a specific recipient
	 */
	async getScheduledPaymentsForRecipient(recipient: string): Promise<{
		success: boolean;
		payments?: ScheduledPayment[];
		scheduleIds?: string[];
		error?: string;
	}> {
		try {
			if (!this.evmContract) {
				return {
					success: false,
					error: "EVM contract not initialized",
				};
			}

			// Get schedule IDs from EVM contract
			const scheduleIds =
				await this.evmContract!.getSchedulesForRecipient(recipient);

			const payments: ScheduledPayment[] = [];

			// Get details for each schedule
			for (const scheduleId of scheduleIds) {
				try {
					const schedule = await this.evmContract!.getSchedule(
						scheduleId
					);
					if (!schedule) continue;

					payments.push({
						id: scheduleId.toString(),
						recipient: schedule.recipient,
						amount: ethers.formatEther(schedule.amount),
						delaySeconds: parseInt(schedule.delaySeconds),
						scheduledTime: new Date(
							parseInt(schedule.createdAt) * 1000 +
								parseInt(schedule.delaySeconds) * 1000
						),
						executed: schedule.executed,
						cadenceTxId: schedule.cadenceTxId,
					});
				} catch (error) {
					console.warn("Failed to get schedule details", {
						scheduleId,
						error,
					});
				}
			}

			console.info("Retrieved scheduled payments for recipient", {
				recipient,
				count: payments.length,
			});

			return {
				success: true,
				payments,
				scheduleIds: scheduleIds.map((id: any) => id.toString()),
			};
		} catch (error) {
			console.error("Failed to get scheduled payments for recipient", {
				error,
				recipient,
			});
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	/**
	 * Execute a scheduled payment via EVM contract
	 */
	async executeScheduledPayment(paymentId: string): Promise<{
		success: boolean;
		evmTxHash?: string;
		error?: string;
	}> {
		try {
			if (!this.evmContract) {
				return {
					success: false,
					error: "EVM contract not initialized",
				};
			}

			console.info("Executing scheduled payment", { paymentId });

			// Execute the schedule on EVM contract
			const tx = await this.evmContract!.executeSchedule(paymentId);
			console.info("EVM transaction sent for execution", {
				txHash: tx.hash,
			});

			// Wait for transaction confirmation
			const receipt = await tx.wait();

			// Find the ScheduleExecuted event
			const event = receipt.logs.find((log: any) => {
				try {
					const parsed = this.evmContract?.interface.parseLog(log);
					return parsed?.name === "ScheduleExecuted";
				} catch {
					return false;
				}
			});

			if (event && this.evmContract) {
				const parsed = this.evmContract.interface.parseLog(event);
				if (parsed && parsed.args) {
					const success = parsed.args.success;
					console.info("Scheduled payment executed", {
						paymentId,
						evmTxHash: tx.hash,
						success,
					});

					return {
						success: true,
						evmTxHash: tx.hash,
					};
				}
			}

			return {
				success: true,
				evmTxHash: tx.hash,
			};
		} catch (error) {
			console.error("Failed to execute scheduled payment", {
				error,
				paymentId,
			});
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	/**
	 * Get a specific scheduled payment by ID from EVM contract
	 */
	async getScheduledPaymentById(paymentId: string): Promise<{
		success: boolean;
		payment?: ScheduledPayment;
		error?: string;
	}> {
		try {
			if (!this.evmContract) {
				return {
					success: false,
					error: "EVM contract not initialized",
				};
			}

			const schedule = await this.evmContract!.getSchedule(paymentId);

			if (!schedule || schedule.id.toString() === "0") {
				return {
					success: false,
					error: "Payment not found",
				};
			}

			const payment: ScheduledPayment = {
				id: schedule.id.toString(),
				recipient: schedule.recipient,
				amount: ethers.formatEther(schedule.amount),
				delaySeconds: parseInt(schedule.delaySeconds),
				scheduledTime: new Date(
					parseInt(schedule.createdAt) * 1000 +
						parseInt(schedule.delaySeconds) * 1000
				),
				executed: schedule.executed,
				cadenceTxId: schedule.cadenceTxId,
			};

			return {
				success: true,
				payment,
			};
		} catch (error) {
			console.error("Failed to get scheduled payment by ID", {
				error,
				paymentId,
			});
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	/**
	 * Check if a payment is ready to be executed
	 */
	async isPaymentReadyForExecution(paymentId: string): Promise<{
		ready: boolean;
		payment?: ScheduledPayment;
		timeRemaining?: number;
		error?: string;
	}> {
		try {
			const result = await this.getScheduledPaymentById(paymentId);

			if (!result.success || !result.payment) {
				return {
					ready: false,
					error: result.error || "Payment not found",
				};
			}

			const payment = result.payment;
			const now = new Date();
			const timeRemaining =
				payment.scheduledTime.getTime() - now.getTime();

			return {
				ready: timeRemaining <= 0 && !payment.executed,
				payment,
				timeRemaining: Math.max(0, Math.floor(timeRemaining / 1000)),
			};
		} catch (error) {
			console.error("Failed to check payment execution readiness", {
				error,
				paymentId,
			});
			return {
				ready: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	/**
	 * Process all payments that are ready for execution
	 */
	async processReadyPayments(): Promise<{
		processed: number;
		successful: number;
		failed: number;
		errors: string[];
	}> {
		try {
			console.info("Processing ready payments");

			const allPaymentsResult = await this.getAllScheduledPayments();
			if (!allPaymentsResult.success || !allPaymentsResult.payments) {
				return {
					processed: 0,
					successful: 0,
					failed: 0,
					errors: [
						allPaymentsResult.error || "Failed to get payments",
					],
				};
			}

			const payments = allPaymentsResult.payments;
			const now = new Date();
			const readyPayments = payments.filter(
				(payment) => !payment.executed && payment.scheduledTime <= now
			);

			console.info("Found ready payments", {
				count: readyPayments.length,
			});

			let successful = 0;
			let failed = 0;
			const errors: string[] = [];

			for (const payment of readyPayments) {
				try {
					const result = await this.executeScheduledPayment(
						payment.id
					);
					if (result.success) {
						successful++;
						console.info("Payment executed successfully", {
							paymentId: payment.id,
							evmTxHash: result.evmTxHash,
						});
					} else {
						failed++;
						errors.push(`Payment ${payment.id}: ${result.error}`);
					}
				} catch (error) {
					failed++;
					const errorMsg =
						error instanceof Error
							? error.message
							: "Unknown error";
					errors.push(`Payment ${payment.id}: ${errorMsg}`);
					console.error("Failed to execute payment", {
						paymentId: payment.id,
						error,
					});
				}
			}

			console.info("Payment processing completed", {
				processed: readyPayments.length,
				successful,
				failed,
			});

			return {
				processed: readyPayments.length,
				successful,
				failed,
				errors,
			};
		} catch (error) {
			console.error("Failed to process ready payments", { error });
			return {
				processed: 0,
				successful: 0,
				failed: 1,
				errors: [
					error instanceof Error ? error.message : "Unknown error",
				],
			};
		}
	}
}

export function createFlowSchedulerService(): FlowSchedulerService {
	return new FlowSchedulerService();
}
