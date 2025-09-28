import { ethers } from "ethers";
import * as fcl from "@onflow/fcl";
import {
	EVMBridgeConfig,
	EVMSchedule,
	EVMBridgeEvent,
	BridgeCallRequest,
	BridgeExecutionResult,
	EVMContractABI,
} from "../types";

// EVM Bridge Configuration - UpdatedEVMScheduler contract
export const EVM_BRIDGE_CONFIG: EVMBridgeConfig = {
	contractAddress: "0x7FA7E751C514ab4CB7D0Fb64a2605B644044D917", // Your deployed UpdatedEVMScheduler
	cadenceAddress: "0x9f3e9372a21a4f15", // NativeEVMBridge address
	rpcUrl: "https://testnet.evm.nodes.onflow.org",
	chainId: 545, // Flow EVM testnet
	explorerBase: "https://evm-testnet.flowscan.io",
};

// Essential Contract ABI for UpdatedEVMScheduler
export const EVM_CONTRACT_ABI: string[] = [
	// Core scheduling functions
	"function schedulePayment(string memory recipient, uint256 amount, uint256 delaySeconds) external payable returns (uint256)",
	"function getSchedule(uint256 scheduleId) external view returns (uint256 id, string memory recipient, uint256 amount, uint256 delaySeconds, uint256 createdAt, address creator, bool bridgeTriggered, bool executed)",
	"function getSchedulesByCreator(address creator) external view returns (uint256[] memory)",
	"function getTotalSchedules() external view returns (uint256)",
	// Essential events for bridge functionality
	"event BridgeCallRequested(uint256 indexed scheduleId, string recipient, uint256 amount, uint256 delaySeconds, uint256 timestamp, address indexed caller)",
	"event ScheduleCreated(uint256 indexed scheduleId, address indexed creator, string recipient, uint256 amount, uint256 delaySeconds, bool bridgeTriggered)",
];

// Cadence transaction for scheduling payments
const CADENCE_SCHEDULE_TRANSACTION = `
import NativeEVMBridge from 0x9f3e9372a21a4f15

transaction(recipient: String, amount: UInt256, delaySeconds: UInt64, evmTxHash: String) {
    prepare(signer: AuthAccount) {
        let bridge = signer.borrow<&NativeEVMBridge.BridgeResource>(from: /storage/EVMBridge)
            ?? panic("Could not borrow bridge resource")
        
        bridge.schedulePayment(
            recipient: recipient,
            amount: amount,
            delaySeconds: delaySeconds,
            evmTxHash: evmTxHash
        )
    }
}
`;

export class EVMBridgeService {
	private provider: ethers.JsonRpcProvider;
	private contract: ethers.Contract;
	private isListening: boolean = false;

	constructor() {
		try {
			this.provider = new ethers.JsonRpcProvider(
				EVM_BRIDGE_CONFIG.rpcUrl
			);
			this.contract = new ethers.Contract(
				EVM_BRIDGE_CONFIG.contractAddress,
				EVM_CONTRACT_ABI,
				this.provider
			);

			this.initializeFCL();

			// Add error handler for provider
			this.provider.on("error", (error) => {
				console.error("EVM Provider error:", error);
			});
		} catch (error) {
			console.error("Failed to initialize EVM Bridge Service:", error);
		}
	}

	private initializeFCL() {
		fcl.config({
			"accessNode.api": "https://rest-testnet.onflow.org",
			"discovery.wallet":
				"https://fcl-discovery.onflow.org/testnet/authn",
			"flow.network": "testnet",
		});
	}

	/**
	 * Start listening for EVM bridge events
	 */
	public startEventListener(): void {
		if (this.isListening) {
			console.warn("EVM bridge event listener already running");
			return;
		}

		console.info("🌉 Starting EVM bridge event listener", {
			contractAddress: EVM_BRIDGE_CONFIG.contractAddress,
			chainId: EVM_BRIDGE_CONFIG.chainId,
		});

		try {
			// Listen for BridgeCallRequested events with error handling
			this.contract.on("BridgeCallRequested", async (...args: any[]) => {
				try {
					// Handle variable argument length from ethers v6
					const [
						scheduleId,
						recipient,
						amount,
						delaySeconds,
						timestamp,
						caller,
						event,
					] = args;

					const bridgeEvent: EVMBridgeEvent = {
						scheduleId: scheduleId.toString(),
						recipient,
						amount: amount.toString(),
						delaySeconds: Number(delaySeconds),
						timestamp: Number(timestamp),
						caller,
						blockNumber: event?.blockNumber || 0,
						transactionHash: event?.transactionHash || "",
					};

					console.info("🚨 Bridge call requested", bridgeEvent);

					// Execute bridge call to Cadence
					await this.executeBridgeCall({
						scheduleId: bridgeEvent.scheduleId,
						recipient: bridgeEvent.recipient,
						amount: bridgeEvent.amount,
						delaySeconds: bridgeEvent.delaySeconds,
						evmTxHash: bridgeEvent.transactionHash,
						blockNumber: bridgeEvent.blockNumber,
					});
				} catch (error) {
					console.error("Error processing bridge call event", {
						error,
					});
				}
			});

			// Listen for ScheduleCreated events for logging
			this.contract.on("ScheduleCreated", (...args: any[]) => {
				try {
					const [
						scheduleId,
						creator,
						recipient,
						amount,
						delaySeconds,
						bridgeTriggered,
						event,
					] = args;

					console.info("📅 Schedule created on EVM", {
						scheduleId: scheduleId.toString(),
						creator,
						recipient,
						amount: amount.toString(),
						delaySeconds: Number(delaySeconds),
						bridgeTriggered,
						txHash: event?.transactionHash || "",
					});
				} catch (error) {
					console.error("Error processing ScheduleCreated event", {
						error,
					});
				}
			});

			this.isListening = true;
			console.info("✅ EVM Bridge event listeners started successfully");
		} catch (error) {
			console.error("❌ Failed to start EVM Bridge event listeners", {
				error,
			});
		}
	}

	/**
	 * Stop listening for EVM bridge events
	 */
	public stopEventListener(): void {
		if (!this.isListening) {
			return;
		}

		console.info("🛑 Stopping EVM bridge event listener");
		this.contract.removeAllListeners();
		this.isListening = false;
	}

	/**
	 * Execute bridge call to Cadence
	 */
	private async executeBridgeCall(
		request: BridgeCallRequest
	): Promise<BridgeExecutionResult> {
		try {
			console.info("🌉 Executing bridge call to Cadence", request);

			// For now, we'll simulate the Cadence transaction
			// In production, you would need proper Flow account setup and authorization
			const cadenceTxId = await this.sendCadenceTransaction(
				request.recipient,
				request.amount,
				request.delaySeconds,
				request.evmTxHash
			);

			const result: BridgeExecutionResult = {
				success: true,
				cadenceTxId,
				executedAt: new Date(),
			};

			console.info("✅ Bridge call executed successfully", result);
			return result;
		} catch (error) {
			const result: BridgeExecutionResult = {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
				executedAt: new Date(),
			};

			console.error("❌ Bridge call failed", { error, request });
			return result;
		}
	}

	/**
	 * Send Cadence transaction to schedule payment
	 */
	private async sendCadenceTransaction(
		recipient: string,
		amount: string,
		delaySeconds: number,
		evmTxHash: string
	): Promise<string> {
		try {
			// This is a simplified version - in production you'd need proper authorization
			const response = await fcl.mutate({
				cadence: CADENCE_SCHEDULE_TRANSACTION,
				args: (arg: any, t: any) => [
					arg(recipient, t.String),
					arg(amount, t.UInt256),
					arg(delaySeconds.toString(), t.UInt64),
					arg(evmTxHash, t.String),
				],
				limit: 1000,
			});

			console.info("📝 Cadence transaction sent", { txId: response });
			return response;
		} catch (error) {
			console.error("Failed to send Cadence transaction", { error });
			throw error;
		}
	}

	/**
	 * Get schedule details from EVM contract
	 */
	public async getSchedule(scheduleId: string): Promise<EVMSchedule | null> {
		try {
			if (!this.contract) return null;
			const schedule = await this.contract.getSchedule(scheduleId);
			if (!schedule) return null;

			return {
				id: schedule.id.toString(),
				recipient: schedule.recipient,
				amount: schedule.amount.toString(),
				delaySeconds: Number(schedule.delaySeconds),
				createdAt: new Date(Number(schedule.createdAt) * 1000),
				creator: schedule.creator,
				bridgeTriggered: schedule.bridgeTriggered,
				executed: schedule.executed,
			};
		} catch (error) {
			console.error("Error getting schedule from EVM contract", {
				error,
				scheduleId,
			});
			return null;
		}
	}

	/**
	 * Get all schedules for a creator
	 */
	public async getSchedulesByCreator(
		creator: string
	): Promise<EVMSchedule[]> {
		try {
			if (!this.contract) return [];
			const scheduleIds = await this.contract.getSchedulesByCreator(
				creator
			);
			if (!scheduleIds) return [];
			const schedules: EVMSchedule[] = [];

			for (const id of scheduleIds) {
				const schedule = await this.getSchedule(id.toString());
				if (schedule) {
					schedules.push(schedule);
				}
			}

			return schedules.sort(
				(a, b) => b.createdAt.getTime() - a.createdAt.getTime()
			);
		} catch (error) {
			console.error("Error getting schedules by creator", {
				error,
				creator,
			});
			return [];
		}
	}

	/**
	 * Get total number of schedules
	 */
	public async getTotalSchedules(): Promise<number> {
		try {
			if (!this.contract) return 0;
			const total = await this.contract.getTotalSchedules();
			return Number(total || 0);
		} catch (error) {
			console.error("Error getting total schedules", { error });
			return 0;
		}
	}

	/**
	 * Schedule payment from calendar AI event
	 */
	public async scheduleFromCalendarEvent(
		recipient: string,
		amount: string,
		delaySeconds: number,
		eventId?: string
	): Promise<{
		success: boolean;
		scheduleId?: string;
		transactionHash?: string;
		error?: string;
	}> {
		try {
			console.info("🤖 Scheduling payment from AI calendar event", {
				recipient,
				amount,
				delaySeconds,
				eventId,
				scheduledTime: new Date(
					Date.now() + delaySeconds * 1000
				).toISOString(),
			});

			if (!this.contract) {
				return {
					success: false,
					error: "EVM contract not initialized",
				};
			}

			// Convert amount to wei (assuming FLOW token with 18 decimals)
			const amountWei = ethers.parseEther(amount);

			// Call schedulePayment on your UpdatedEVMScheduler contract
			const tx = await this.contract!.schedulePayment(
				recipient,
				amountWei,
				delaySeconds
			);

			console.info("📋 EVM transaction sent for calendar event", {
				txHash: tx.hash,
				eventId,
				recipient,
				amount,
			});

			// Wait for transaction confirmation
			const receipt = await tx.wait();

			// Extract schedule ID from events
			let scheduleId: string | undefined;
			for (const log of receipt.logs) {
				try {
					const parsed = this.contract!.interface.parseLog(log);
					if (parsed?.name === "ScheduleCreated") {
						scheduleId = parsed.args.scheduleId.toString();
						break;
					}
				} catch {
					// Ignore parsing errors for other events
				}
			}

			console.info("✅ Calendar event scheduled successfully on EVM", {
				scheduleId,
				txHash: tx.hash,
				eventId,
				bridgeTriggered: true,
			});

			return {
				success: true,
				scheduleId,
				transactionHash: tx.hash,
			};
		} catch (error) {
			console.error("❌ Failed to schedule calendar event on EVM", {
				error,
				recipient,
				amount,
				eventId,
			});

			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	/**
	 * Check if the bridge service is healthy
	 */
	public async isHealthy(): Promise<boolean> {
		try {
			// Check EVM connection
			const blockNumber = await this.provider.getBlockNumber();

			// Check contract connection
			const totalSchedules = await this.getTotalSchedules();

			return blockNumber > 0 && totalSchedules >= 0;
		} catch (error) {
			console.error("Bridge health check failed", { error });
			return false;
		}
	}

	/**
	 * Get bridge configuration
	 */
	public getConfig(): EVMBridgeConfig {
		return EVM_BRIDGE_CONFIG;
	}
}

// Singleton instance
export const evmBridgeService = new EVMBridgeService();
