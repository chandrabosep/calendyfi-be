import express from "express";
import { evmBridgeService } from "../services/evm-bridge";
import { ApiResponse, EVMScheduleRequest } from "../types";

const router = express.Router();

/**
 * GET /api/evm-bridge/config
 * Get EVM bridge configuration
 */
router.get("/config", async (req, res) => {
	try {
		const config = evmBridgeService.getConfig();

		res.json({
			success: true,
			data: config,
		} as ApiResponse);
	} catch (error) {
		console.error("Error getting bridge config", { error });
		res.status(500).json({
			success: false,
			error: "Failed to get bridge configuration",
		} as ApiResponse);
	}
});

/**
 * GET /api/evm-bridge/health
 * Check bridge service health
 */
router.get("/health", async (req, res) => {
	try {
		const isHealthy = await evmBridgeService.isHealthy();
		const totalSchedules = await evmBridgeService.getTotalSchedules();

		res.json({
			success: true,
			data: {
				healthy: isHealthy,
				totalSchedules,
				timestamp: new Date().toISOString(),
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Error checking bridge health", { error });
		res.status(500).json({
			success: false,
			error: "Failed to check bridge health",
		} as ApiResponse);
	}
});

/**
 * GET /api/evm-bridge/schedule/:scheduleId
 * Get specific schedule details
 */
router.get("/schedule/:scheduleId", async (req, res) => {
	try {
		const { scheduleId } = req.params;

		if (!scheduleId || isNaN(Number(scheduleId))) {
			return res.status(400).json({
				success: false,
				error: "Invalid schedule ID",
			} as ApiResponse);
		}

		const schedule = await evmBridgeService.getSchedule(scheduleId);

		if (!schedule) {
			return res.status(404).json({
				success: false,
				error: "Schedule not found",
			} as ApiResponse);
		}

		return res.json({
			success: true,
			data: schedule,
		} as ApiResponse);
	} catch (error) {
		console.error("Error getting schedule", {
			error,
			scheduleId: req.params.scheduleId,
		});
		return res.status(500).json({
			success: false,
			error: "Failed to get schedule",
		} as ApiResponse);
	}
});

/**
 * GET /api/evm-bridge/schedules/creator/:creator
 * Get all schedules for a creator address
 */
router.get("/schedules/creator/:creator", async (req, res) => {
	try {
		const { creator } = req.params;

		if (!creator || !/^0x[a-fA-F0-9]{40}$/.test(creator)) {
			return res.status(400).json({
				success: false,
				error: "Invalid creator address",
			} as ApiResponse);
		}

		const schedules = await evmBridgeService.getSchedulesByCreator(creator);

		return res.json({
			success: true,
			data: {
				schedules,
				count: schedules.length,
				creator,
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Error getting schedules by creator", {
			error,
			creator: req.params.creator,
		});
		return res.status(500).json({
			success: false,
			error: "Failed to get schedules",
		} as ApiResponse);
	}
});

/**
 * GET /api/evm-bridge/stats
 * Get bridge statistics
 */
router.get("/stats", async (req, res) => {
	try {
		const totalSchedules = await evmBridgeService.getTotalSchedules();
		const isHealthy = await evmBridgeService.isHealthy();

		res.json({
			success: true,
			data: {
				totalSchedules,
				bridgeHealthy: isHealthy,
				contractAddress: evmBridgeService.getConfig().contractAddress,
				cadenceAddress: evmBridgeService.getConfig().cadenceAddress,
				chainId: evmBridgeService.getConfig().chainId,
				timestamp: new Date().toISOString(),
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Error getting bridge stats", { error });
		res.status(500).json({
			success: false,
			error: "Failed to get bridge statistics",
		} as ApiResponse);
	}
});

/**
 * POST /api/evm-bridge/validate-address
 * Validate an Ethereum address
 */
router.post("/validate-address", async (req, res) => {
	try {
		const { address } = req.body;

		if (!address) {
			return res.status(400).json({
				success: false,
				error: "Address is required",
			} as ApiResponse);
		}

		const isValid = /^0x[a-fA-F0-9]{40}$/.test(address);

		return res.json({
			success: true,
			data: {
				address,
				isValid,
				format: isValid ? "valid" : "invalid",
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Error validating address", { error });
		return res.status(500).json({
			success: false,
			error: "Failed to validate address",
		} as ApiResponse);
	}
});

/**
 * POST /api/evm-bridge/estimate-gas
 * Estimate gas for a schedule payment transaction
 */
router.post("/estimate-gas", async (req, res) => {
	try {
		const { recipient, amount, delaySeconds }: EVMScheduleRequest =
			req.body;

		// Validate input
		if (!recipient || !amount || !delaySeconds) {
			return res.status(400).json({
				success: false,
				error: "Missing required fields: recipient, amount, delaySeconds",
			} as ApiResponse);
		}

		if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
			return res.status(400).json({
				success: false,
				error: "Invalid recipient address",
			} as ApiResponse);
		}

		if (isNaN(Number(amount)) || Number(amount) <= 0) {
			return res.status(400).json({
				success: false,
				error: "Invalid amount",
			} as ApiResponse);
		}

		if (isNaN(Number(delaySeconds)) || Number(delaySeconds) < 60) {
			return res.status(400).json({
				success: false,
				error: "Delay must be at least 60 seconds",
			} as ApiResponse);
		}

		// For now, return estimated gas (in production, you'd call the contract)
		const estimatedGas = 300000; // Typical gas limit for the transaction
		const gasPrice = 20000000000; // 20 gwei in wei
		const estimatedCost = estimatedGas * gasPrice;

		return res.json({
			success: true,
			data: {
				estimatedGas,
				gasPrice,
				estimatedCost: estimatedCost.toString(),
				estimatedCostEth: (estimatedCost / 1e18).toFixed(6),
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Error estimating gas", { error });
		return res.status(500).json({
			success: false,
			error: "Failed to estimate gas",
		} as ApiResponse);
	}
});

/**
 * GET /api/evm-bridge/contract-abi
 * Get the contract ABI for frontend integration
 */
router.get("/contract-abi", async (req, res) => {
	try {
		const abi = [
			"function schedulePayment(string memory recipient, uint256 amount, uint256 delaySeconds) external payable returns (uint256)",
			"function getSchedule(uint256 scheduleId) external view returns (uint256 id, string memory recipient, uint256 amount, uint256 delaySeconds, uint256 createdAt, address creator, bool bridgeTriggered, bool executed)",
			"function getSchedulesByCreator(address creator) external view returns (uint256[] memory)",
			"function getTotalSchedules() external view returns (uint256)",
			"event BridgeCallRequested(uint256 indexed scheduleId, string recipient, uint256 amount, uint256 delaySeconds, uint256 timestamp, address indexed caller)",
			"event ScheduleCreated(uint256 indexed scheduleId, address indexed creator, string recipient, uint256 amount, uint256 delaySeconds, bool bridgeTriggered)",
		];

		res.json({
			success: true,
			data: {
				abi,
				contractAddress: evmBridgeService.getConfig().contractAddress,
				chainId: evmBridgeService.getConfig().chainId,
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Error getting contract ABI", { error });
		res.status(500).json({
			success: false,
			error: "Failed to get contract ABI",
		} as ApiResponse);
	}
});

/**
 * GET /api/evm-bridge/network-info
 * Get network information for wallet connection
 */
router.get("/network-info", async (req, res) => {
	try {
		const config = evmBridgeService.getConfig();

		res.json({
			success: true,
			data: {
				chainId: config.chainId,
				chainIdHex: `0x${config.chainId.toString(16)}`,
				chainName: "Flow EVM Testnet",
				nativeCurrency: {
					name: "FLOW",
					symbol: "FLOW",
					decimals: 18,
				},
				rpcUrls: [config.rpcUrl],
				blockExplorerUrls: [config.explorerBase],
				contractAddress: config.contractAddress,
				cadenceAddress: config.cadenceAddress,
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Error getting network info", { error });
		res.status(500).json({
			success: false,
			error: "Failed to get network information",
		} as ApiResponse);
	}
});

export default router;
