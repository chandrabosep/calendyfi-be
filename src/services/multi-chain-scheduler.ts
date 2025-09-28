import { ethers } from "ethers";
import { config } from "../config";
import { ScheduleParser } from "../utils/schedule-parser";
import {
	AdvancedScheduleRequest,
	ParsedSchedule,
	RecurringSchedule,
	CustomSchedule,
	ChainConfig,
} from "../types";

// Contract ABIs for different chains
const SEPOLIA_SCHEDULER_ABI = [
	"function schedulePayment(address recipient, uint256 amount, uint256 delaySeconds) external returns (uint256)",
	"function executeSchedule(uint256 scheduleId) external",
	"function getSchedule(uint256 scheduleId) external view returns (tuple(uint256 id, address recipient, uint256 amount, uint256 delaySeconds, uint256 createdAt, bool executed))",
	"function getSchedulesForRecipient(address recipient) external view returns (uint256[])",
	"function nextScheduleId() external view returns (uint256)",
	"event ScheduleCreated(uint256 indexed scheduleId, address indexed recipient, uint256 amount, uint256 delaySeconds)",
	"event ScheduleExecuted(uint256 indexed scheduleId, bool success)",
];

const ROOTSTOCK_SCHEDULER_ABI = [
	"function schedulePayment(address recipient, uint256 amount, uint256 delaySeconds) external returns (uint256)",
	"function executeSchedule(uint256 scheduleId) external",
	"function getSchedule(uint256 scheduleId) external view returns (tuple(uint256 id, address recipient, uint256 amount, uint256 delaySeconds, uint256 createdAt, bool executed))",
	"function getSchedulesForRecipient(address recipient) external view returns (uint256[])",
	"function nextScheduleId() external view returns (uint256)",
	"event ScheduleCreated(uint256 indexed scheduleId, address indexed recipient, uint256 amount, uint256 delaySeconds)",
	"event ScheduleExecuted(uint256 indexed scheduleId, bool success)",
];

// Contract addresses for different chains
const CONTRACT_ADDRESSES = {
	11155111: "0x1234567890123456789012345678901234567890", // Sepolia
	31: "0x2345678901234567890123456789012345678901", // Rootstock
	545: "0x7FA7E751C514ab4CB7D0Fb64a2605B644044D917", // Flow EVM - Your deployed UpdatedEVMScheduler
	646: "0x9f3e9372a21a4f15", // Flow Cadence
};

export interface MultiChainScheduleRequest {
	recipient: string;
	amount: string;
	userId: string;
	eventId?: string;
	description?: string;
	scheduleType: "once" | "recurring" | "custom";
	chains: number[]; // Array of chain IDs to schedule on
	// For one-time scheduling
	delaySeconds?: number;
	scheduledTime?: Date;
	// For recurring scheduling
	recurringSchedule?: RecurringSchedule;
	// For custom scheduling
	customSchedule?: CustomSchedule;
}

export interface MultiChainScheduleResult {
	success: boolean;
	results: {
		[chainId: number]: {
			success: boolean;
			scheduleIds?: string[];
			txHashes?: string[];
			scheduledTimes?: Date[];
			error?: string;
		};
	};
	totalSchedules: number;
	successfulChains: number;
	failedChains: number;
}

export class MultiChainSchedulerService {
	private providers: Map<number, ethers.JsonRpcProvider> = new Map();
	private contracts: Map<number, ethers.Contract> = new Map();

	constructor() {
		this.initializeProviders();
	}

	/**
	 * Initialize providers and contracts for all configured chains
	 */
	private initializeProviders(): void {
		for (const chain of config.chains) {
			try {
				// Create provider
				const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
				this.providers.set(chain.chainId, provider);

				// Create contract instance
				const signer = new ethers.Wallet(
					chain.deployerPrivateKey,
					provider
				);
				const contractAddress =
					CONTRACT_ADDRESSES[
						chain.chainId as keyof typeof CONTRACT_ADDRESSES
					];

				if (contractAddress) {
					let abi;
					if (chain.chainId === 11155111) {
						abi = SEPOLIA_SCHEDULER_ABI;
					} else if (chain.chainId === 31) {
						abi = ROOTSTOCK_SCHEDULER_ABI;
					} else if (chain.chainId === 545) {
						abi = SEPOLIA_SCHEDULER_ABI; // Flow EVM uses similar ABI
					}

					if (abi) {
						const contract = new ethers.Contract(
							contractAddress,
							abi,
							signer
						);
						this.contracts.set(chain.chainId, contract);
					}
				}

				console.info(
					`Multi-chain scheduler initialized for ${chain.name}`,
					{
						chainId: chain.chainId,
						contractAddress,
					}
				);
			} catch (error) {
				console.error(`Failed to initialize chain ${chain.chainId}`, {
					error,
				});
			}
		}
	}

	/**
	 * Schedule payment across multiple chains
	 */
	async scheduleMultiChain(
		request: MultiChainScheduleRequest
	): Promise<MultiChainScheduleResult> {
		try {
			console.info("Scheduling multi-chain payment", {
				chains: request.chains,
				scheduleType: request.scheduleType,
				recipient: request.recipient,
				amount: request.amount,
			});

			// Parse the schedule
			let parsedSchedule: ParsedSchedule;

			if (request.scheduleType === "once") {
				const scheduledTime =
					request.scheduledTime ||
					new Date(Date.now() + (request.delaySeconds || 0) * 1000);
				parsedSchedule = {
					type: "once",
					executions: [scheduledTime],
				};
			} else if (
				request.scheduleType === "recurring" &&
				request.recurringSchedule
			) {
				parsedSchedule = this.parseRecurringSchedule(
					request.recurringSchedule
				);
			} else if (
				request.scheduleType === "custom" &&
				request.customSchedule
			) {
				parsedSchedule = ScheduleParser.parseNaturalLanguage(
					request.customSchedule.pattern,
					request.customSchedule.startDate
				);
			} else {
				return {
					success: false,
					results: {},
					totalSchedules: 0,
					successfulChains: 0,
					failedChains: 0,
				};
			}

			if (parsedSchedule.error) {
				return {
					success: false,
					results: {},
					totalSchedules: 0,
					successfulChains: 0,
					failedChains: 0,
				};
			}

			// Schedule on each chain
			const results: { [chainId: number]: any } = {};
			let successfulChains = 0;
			let failedChains = 0;

			for (const chainId of request.chains) {
				try {
					const chainResult = await this.scheduleOnChain(
						chainId,
						request,
						parsedSchedule
					);
					results[chainId] = chainResult;

					if (chainResult.success) {
						successfulChains++;
					} else {
						failedChains++;
					}
				} catch (error) {
					results[chainId] = {
						success: false,
						error:
							error instanceof Error
								? error.message
								: "Unknown error",
					};
					failedChains++;
				}
			}

			const totalSchedules = Object.values(results).reduce(
				(sum, result) => sum + (result.scheduleIds?.length || 0),
				0
			);

			console.info("Multi-chain scheduling completed", {
				totalSchedules,
				successfulChains,
				failedChains,
			});

			return {
				success: successfulChains > 0,
				results,
				totalSchedules,
				successfulChains,
				failedChains,
			};
		} catch (error) {
			console.error("Failed to schedule multi-chain payment", { error });
			return {
				success: false,
				results: {},
				totalSchedules: 0,
				successfulChains: 0,
				failedChains: 1,
			};
		}
	}

	/**
	 * Schedule payment on a specific chain
	 */
	private async scheduleOnChain(
		chainId: number,
		request: MultiChainScheduleRequest,
		parsedSchedule: ParsedSchedule
	): Promise<{
		success: boolean;
		scheduleIds?: string[];
		txHashes?: string[];
		scheduledTimes?: Date[];
		error?: string;
	}> {
		const contract = this.contracts.get(chainId);
		if (!contract) {
			return {
				success: false,
				error: `Contract not available for chain ${chainId}`,
			};
		}

		const scheduleIds: string[] = [];
		const txHashes: string[] = [];
		const scheduledTimes: Date[] = [];

		for (const executionTime of parsedSchedule.executions) {
			const delaySeconds =
				ScheduleParser.calculateDelaySeconds(executionTime);

			// Skip past executions
			if (delaySeconds <= 0) {
				console.warn("Skipping past execution time", {
					executionTime,
					chainId,
				});
				continue;
			}

			try {
				// Convert amount to wei
				const amountWei = ethers.parseEther(request.amount);

				// Schedule payment on chain
				if (!contract) throw new Error("Contract not available");
				const tx = await (contract as any).schedulePayment(
					request.recipient,
					amountWei,
					delaySeconds
				);

				// Wait for confirmation
				const receipt = await tx.wait();

				// Extract schedule ID from events
				const event = receipt.logs.find((log: any) => {
					try {
						const parsed = contract.interface.parseLog(log);
						return parsed?.name === "ScheduleCreated";
					} catch {
						return false;
					}
				});

				let scheduleId: string;
				if (event) {
					const parsed = contract.interface.parseLog(event);
					scheduleId =
						parsed?.args?.scheduleId?.toString() ||
						`schedule-${Date.now()}`;
				} else {
					scheduleId = `schedule-${Date.now()}`;
				}

				scheduleIds.push(scheduleId);
				txHashes.push(tx.hash);
				scheduledTimes.push(executionTime);

				console.info("Payment scheduled on chain", {
					chainId,
					scheduleId,
					txHash: tx.hash,
					executionTime,
				});
			} catch (error) {
				console.error("Failed to schedule payment on chain", {
					chainId,
					executionTime,
					error,
				});
			}
		}

		return {
			success: scheduleIds.length > 0,
			scheduleIds,
			txHashes,
			scheduledTimes,
		};
	}

	/**
	 * Parse recurring schedule into execution times
	 */
	private parseRecurringSchedule(
		schedule: RecurringSchedule
	): ParsedSchedule {
		const executions: Date[] = [];
		const startDate = schedule.startDate;
		const endDate =
			schedule.endDate ||
			new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // Default to 1 year

		let currentDate = new Date(startDate);

		while (currentDate <= endDate) {
			executions.push(new Date(currentDate));

			// Calculate next execution based on schedule type
			switch (schedule.type) {
				case "daily":
					currentDate.setDate(
						currentDate.getDate() + schedule.interval
					);
					break;
				case "weekly":
					currentDate.setDate(
						currentDate.getDate() + schedule.interval * 7
					);
					break;
				case "monthly":
					currentDate.setMonth(
						currentDate.getMonth() + schedule.interval
					);
					break;
				case "yearly":
					currentDate.setFullYear(
						currentDate.getFullYear() + schedule.interval
					);
					break;
				default:
					throw new Error(
						`Unsupported recurring schedule type: ${schedule.type}`
					);
			}
		}

		return {
			type: "recurring",
			executions,
			pattern: `${schedule.type} every ${schedule.interval}`,
		};
	}

	/**
	 * Schedule with natural language pattern across multiple chains
	 */
	async schedulePatternMultiChain(
		recipient: string,
		amount: string,
		userId: string,
		pattern: string,
		chains: number[]
	): Promise<MultiChainScheduleResult> {
		const request: MultiChainScheduleRequest = {
			recipient,
			amount,
			userId,
			scheduleType: "custom",
			chains,
			customSchedule: {
				type: "custom",
				pattern,
				startDate: new Date(),
			},
		};

		return this.scheduleMultiChain(request);
	}

	/**
	 * Get available chains for scheduling
	 */
	getAvailableChains(): ChainConfig[] {
		return config.chains.filter((chain) =>
			this.contracts.has(chain.chainId)
		);
	}

	/**
	 * Check if a chain is available for scheduling
	 */
	isChainAvailable(chainId: number): boolean {
		return this.contracts.has(chainId);
	}
}

export function createMultiChainSchedulerService(): MultiChainSchedulerService {
	return new MultiChainSchedulerService();
}
