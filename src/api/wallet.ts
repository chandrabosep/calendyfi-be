import express from "express";
import { PrismaClient } from "@prisma/client";
import { PrivyService } from "../services/wallet/privy-service";
import { SafeService } from "../services/wallet/safe-service";
import { CustomSmartAccountService } from "../services/wallet/custom-smart-account-service";
import Joi from "joi";
import { ApiResponse } from "../types";
import { config } from "../config";
import rateLimit from "express-rate-limit";

const router = express.Router();
const prisma = new PrismaClient();
const privyService = new PrivyService();
const safeService = new SafeService();
const customSmartAccountService = new CustomSmartAccountService();

// Validation schemas
const onboardSchema = Joi.object({
	userId: Joi.string().required(),
	privyWalletAddress: Joi.string()
		.pattern(/^0x[a-fA-F0-9]{40}$/)
		.required(),
	privyWalletId: Joi.string().optional(),
	email: Joi.string().email().optional(),
	chainIds: Joi.array()
		.items(Joi.number().integer().positive())
		.min(1)
		.optional(),
});

const executeSchema = Joi.object({
	userId: Joi.string().required(),
	chainId: Joi.number().integer().positive().required(),
	transactions: Joi.array()
		.items(
			Joi.object({
				to: Joi.string()
					.pattern(/^0x[a-fA-F0-9]{40}$/)
					.required(),
				value: Joi.string().required(),
				data: Joi.string().required(),
			})
		)
		.required(),
});

const revokeSchema = Joi.object({
	userId: Joi.string().required(),
});

// Rate limiting for wallet operations
const walletCreationLimit = rateLimit({
	windowMs: 1 * 60 * 1000, // 15 minutes
	max: 1, // 1 wallet creation per user per 15 minutes
	keyGenerator: (req) => req.body["userId"],
	message: {
		success: false,
		error: "Wallet creation rate limit exceeded. Please try again later.",
	} as ApiResponse,
});

const walletOperationLimit = rateLimit({
	windowMs: 1 * 60 * 1000, // 1 minute
	max: 10, // 10 operations per minute
	keyGenerator: (req) => req.body["userId"] || req.query["userId"],
	message: {
		success: false,
		error: "Too many wallet operations. Please try again later.",
	} as ApiResponse,
});

/**
 * Onboard user - Create agent wallet and deploy Safe
 */
router.post("/onboard", walletCreationLimit, async (req, res) => {
	try {
		// Validate input
		const { error, value } = onboardSchema.validate(req.body);
		if (error) {
			console.warn("Invalid onboard request", { error: error.details });
			return res.status(400).json({
				success: false,
				error: "Invalid input data",
				details: error.details[0]?.message || "Validation error",
			} as ApiResponse);
		}

		const { userId, privyWalletAddress, privyWalletId, email, chainIds } =
			value as {
				userId: string;
				privyWalletAddress: string;
				privyWalletId?: string;
				email?: string;
				chainIds?: number[];
			};

		// If userId is a Privy ID (starts with "did:privy:"), find the internal user ID
		let internalUserId = userId;
		if (userId.startsWith("did:privy:") && email) {
			const user = await prisma.user.findUnique({
				where: { email },
			});
			if (!user) {
				return res.status(404).json({
					success: false,
					error: "User not found in database. Please ensure you're logged in with the same email used for calendar integration.",
				} as ApiResponse);
			}
			internalUserId = user.id;
			console.log("Mapped Privy user ID to internal user ID", {
				privyUserId: userId,
				internalUserId: user.id,
				email,
			});
		}

		// Check if user already has a wallet
		const existing = await prisma.wallet.findUnique({
			where: { userId: internalUserId },
			include: { walletChains: true },
		});

		if (existing) {
			console.warn("Wallet already exists for user", {
				userId: internalUserId,
			});
			return res.status(409).json({
				success: false,
				error: "Wallet already exists for this user",
			} as ApiResponse);
		}

		// Determine which chains to deploy on
		const safeSupportedChainIds = safeService.getSupportedChainIds();
		const customSupportedChainIds =
			customSmartAccountService.getSupportedChainIds();
		const allSupportedChainIds = [
			...safeSupportedChainIds,
			...customSupportedChainIds,
		];

		const chainsToDeploy =
			chainIds && chainIds.length > 0
				? chainIds.filter((id) => allSupportedChainIds.includes(id))
				: allSupportedChainIds; // Deploy on all available chains by default

		if (chainsToDeploy.length === 0) {
			return res.status(400).json({
				success: false,
				error: "No supported chains specified",
			} as ApiResponse);
		}

		console.log("Starting wallet onboarding", {
			userId: internalUserId,
			privyWalletAddress,
			chainsToDeploy,
		});

		// 1. Create agent EOA
		const agent = await privyService.createAgentWallet();
		console.log("Agent wallet created", { agentAddress: agent.address });

		// 2. Deploy smart accounts on each chain (Safe or Custom)
		const deployedSafes: Array<{ chainId: number; safeAddress: string }> =
			[];
		const failedChains: Array<{ chainId: number; error: string }> = [];

		// Remove duplicates from chainsToDeploy to prevent deploying twice
		const uniqueChainsToDeploy = [...new Set(chainsToDeploy)];

		if (uniqueChainsToDeploy.length !== chainsToDeploy.length) {
			console.warn(
				"Duplicate chain IDs detected in deployment list, removing duplicates",
				{
					original: chainsToDeploy,
					unique: uniqueChainsToDeploy,
				}
			);
		}

		for (const chainId of uniqueChainsToDeploy) {
			try {
				let smartAccountAddress: string;

				// Check if chain supports Safe Protocol Kit
				if (safeService.isSafeCompatible(chainId)) {
					smartAccountAddress = await safeService.deploySafe(
						chainId,
						[agent.address, privyWalletAddress],
						1
					);
					console.log("Safe deployed on chain", {
						chainId,
						safeAddress: smartAccountAddress,
					});
				} else {
					// Use custom smart account for unsupported chains
					smartAccountAddress =
						await customSmartAccountService.deployCustomSmartAccount(
							chainId,
							[agent.address, privyWalletAddress],
							1
						);
					console.log("Custom smart account deployed on chain", {
						chainId,
						smartAccountAddress,
					});
				}

				deployedSafes.push({
					chainId,
					safeAddress: smartAccountAddress,
				});
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : "Unknown error";
				console.error("Failed to deploy smart account on chain", {
					chainId,
					error: errorMessage,
				});

				failedChains.push({
					chainId,
					error: errorMessage,
				});

				// Continue with other chains even if one fails
				console.log("Continuing deployment on remaining chains", {
					remainingChains: uniqueChainsToDeploy.filter(
						(id) => id !== chainId
					),
				});
			}
		}

		// Log deployment summary
		console.log("Deployment summary", {
			successful: deployedSafes.length,
			failed: failedChains.length,
			successfulChains: deployedSafes.map((s) => s.chainId),
			failedChains: failedChains.map((f) => ({
				chainId: f.chainId,
				error: f.error,
			})),
		});

		if (deployedSafes.length === 0) {
			return res.status(500).json({
				success: false,
				error: "Failed to deploy Safe on any chain",
				details: {
					failedChains: failedChains.map((f) => ({
						chainId: f.chainId,
						error: f.error,
					})),
				},
			} as ApiResponse);
		}

		// 3. Store in database (private key is stored in PrivyService cache)
		const walletRecord = await prisma.wallet.create({
			data: {
				userId: internalUserId,
				privyWallet: privyWalletAddress,
				privyWalletId: privyWalletId || null,
				agentWalletId: agent.id,
				agentAddress: agent.address,
				status: "ACTIVE",
				walletChains: {
					create: deployedSafes.map(({ chainId, safeAddress }) => ({
						chainId,
						smartAccount: safeAddress,
						status: "ACTIVE",
					})),
				},
			},
		});

		console.log("Wallet onboarding completed successfully", {
			userId: internalUserId,
			walletId: walletRecord.id,
			deployedSafes: deployedSafes,
			failedChains: failedChains,
		});

		return res.json({
			success: true,
			data: {
				wallet: walletRecord,
				deployedSafes: deployedSafes,
				failedChains:
					failedChains.length > 0 ? failedChains : undefined,
				message: `Smart wallet enabled successfully on ${
					deployedSafes.length
				} chain(s)${
					failedChains.length > 0
						? ` (${failedChains.length} chain(s) failed)`
						: ""
				}`,
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Onboarding failed:", error);
		return res.status(500).json({
			success: false,
			error: "Onboarding failed",
			details: error instanceof Error ? error.message : "Unknown error",
		} as ApiResponse);
	}
});

/**
 * Get supported chains
 */
router.get("/chains", async (req, res) => {
	try {
		const safeSupportedChainIds = safeService.getSupportedChainIds();
		const customSupportedChainIds =
			customSmartAccountService.getSupportedChainIds();

		const safeChainConfigs = safeSupportedChainIds.map((chainId) => {
			const config = safeService.getChainConfiguration(chainId);
			return {
				chainId: config.chainId,
				name: config.name,
				rpcUrl: config.rpcUrl,
				type: "safe", // Safe Protocol Kit supported
			};
		});

		const customChainConfigs = customSupportedChainIds.map((chainId) => {
			const config =
				customSmartAccountService.getChainConfiguration(chainId);
			return {
				chainId: config.chainId,
				name: config.name,
				rpcUrl: config.rpcUrl,
				type: "custom", // Custom smart account
			};
		});

		const allChains = [...safeChainConfigs, ...customChainConfigs];

		return res.json({
			success: true,
			data: {
				chains: allChains,
				defaultChainId: config.defaultChainId,
				safeSupported: safeSupportedChainIds,
				customSupported: customSupportedChainIds,
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Failed to get supported chains:", error);
		return res.status(500).json({
			success: false,
			error: "Failed to get supported chains",
		} as ApiResponse);
	}
});

/**
 * Get wallet status
 */
router.get("/status", walletOperationLimit, async (req, res) => {
	try {
		const { userId } = req.query;

		if (!userId) {
			return res.status(400).json({
				success: false,
				error: "userId required",
			} as ApiResponse);
		}

		const wallet = await prisma.wallet.findUnique({
			where: { userId: userId as string },
			include: {
				walletChains: {
					where: { status: "ACTIVE" },
				},
			},
		});

		if (!wallet) {
			return res.json({
				success: true,
				data: { exists: false },
			} as ApiResponse);
		}

		return res.json({
			success: true,
			data: {
				exists: true,
				wallet: {
					agentAddress: wallet.agentAddress,
					status: wallet.status,
					createdAt: wallet.createdAt,
					chains: wallet.walletChains.map((wc) => ({
						chainId: wc.chainId,
						smartAccount: wc.smartAccount,
						status: wc.status,
					})),
				},
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Status check failed:", error);
		return res.status(500).json({
			success: false,
			error: "Status check failed",
		} as ApiResponse);
	}
});

/**
 * Redeploy Safe contract (for fixing wallet issues)
 */
router.post("/redeploy-safe", walletOperationLimit, async (req, res) => {
	try {
		const { userId } = req.body;

		if (!userId) {
			return res.status(400).json({
				success: false,
				error: "userId required",
			} as ApiResponse);
		}

		const wallet = await prisma.wallet.findUnique({
			where: { userId },
			include: { walletChains: true },
		});

		if (!wallet || wallet.status !== "ACTIVE") {
			console.warn("Active wallet not found for redeployment", {
				userId,
				walletStatus: wallet?.status,
			});
			return res.status(404).json({
				success: false,
				error: "Active wallet not found",
			} as ApiResponse);
		}

		// Get the first active wallet chain for redeployment
		const walletChain = wallet.walletChains.find(
			(wc) => wc.status === "ACTIVE"
		);
		if (!walletChain || !walletChain.smartAccount) {
			return res.status(404).json({
				success: false,
				error: "Active wallet chain not found",
			} as ApiResponse);
		}

		console.log("Redeploying Safe contract", {
			userId,
			currentSafe: walletChain.smartAccount,
			agentAddress: wallet.agentAddress,
			chainId: walletChain.chainId,
		});

		// Deploy new Safe with both owners
		const newSafeAddress = await safeService.deploySafe(
			walletChain.chainId,
			[wallet.agentAddress, wallet.privyWallet],
			1
		);

		// Update wallet chain record
		await prisma.walletChain.update({
			where: {
				walletId_chainId: {
					walletId: wallet.id,
					chainId: walletChain.chainId,
				},
			},
			data: {
				smartAccount: newSafeAddress,
			},
		});

		console.log("Safe contract redeployed successfully", {
			userId,
			oldSafe: walletChain.smartAccount,
			newSafe: newSafeAddress,
			chainId: walletChain.chainId,
		});

		return res.json({
			success: true,
			data: {
				oldSafeAddress: walletChain.smartAccount,
				newSafeAddress: newSafeAddress,
				chainId: walletChain.chainId,
				message: "Safe contract redeployed successfully",
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Safe redeployment failed:", error);
		return res.status(500).json({
			success: false,
			error: "Safe redeployment failed",
			details: error instanceof Error ? error.message : "Unknown error",
		} as ApiResponse);
	}
});

export default router;
