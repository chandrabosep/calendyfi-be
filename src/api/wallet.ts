import express from "express";
import { PrismaClient } from "@prisma/client";
import { PrivyService } from "../services/wallet/privy-service";
import { SafeService } from "../services/wallet/safe-service";
import { CustomSmartAccountService } from "../services/wallet/custom-smart-account-service";
import Joi from "joi";
import rateLimit from "express-rate-limit";
import { ApiResponse } from "../types";
import { config } from "../config";

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
	windowMs: 15 * 60 * 1000, // 15 minutes
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
			console.info("Mapped Privy user ID to internal user ID", {
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

		console.info("Starting wallet onboarding", {
			userId: internalUserId,
			privyWalletAddress,
			chainsToDeploy,
		});

		// 1. Create agent EOA
		const agent = await privyService.createAgentWallet();
		console.info("Agent wallet created", { agentAddress: agent.address });

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
					console.info("Safe deployed on chain", {
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
					console.info("Custom smart account deployed on chain", {
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
				console.info("Continuing deployment on remaining chains", {
					remainingChains: uniqueChainsToDeploy.filter(
						(id) => id !== chainId
					),
				});
			}
		}

		// Log deployment summary
		console.info("Deployment summary", {
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

		console.info("Wallet onboarding completed successfully", {
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
 * Execute transaction via agent (internal use)
 */
router.post("/execute", walletOperationLimit, async (req, res) => {
	try {
		// Validate input
		const { error, value } = executeSchema.validate(req.body);
		if (error) {
			console.warn("Invalid execute request", { error: error.details });
			return res.status(400).json({
				success: false,
				error: "Invalid input data",
				details: error.details[0]?.message || "Validation error",
			} as ApiResponse);
		}

		const { userId, chainId, transactions } = value as {
			userId: string;
			chainId: number;
			transactions: Array<{
				to: string;
				value: string;
				data: string;
			}>;
		};

		const wallet = await prisma.wallet.findUnique({
			where: { userId },
			include: {
				walletChains: {
					where: { chainId, status: "ACTIVE" },
				},
			},
		});

		if (!wallet || wallet.status !== "ACTIVE") {
			console.warn("Active wallet not found", {
				userId,
				walletStatus: wallet?.status,
			});
			return res.status(404).json({
				success: false,
				error: "Active wallet not found",
			} as ApiResponse);
		}

		const walletChain = wallet.walletChains[0];
		if (!walletChain || !walletChain.smartAccount) {
			console.warn("Active wallet chain not found", {
				userId,
				chainId,
			});
			return res.status(404).json({
				success: false,
				error: `Active wallet not found on chain ${chainId}`,
			} as ApiResponse);
		}

		console.info("Executing transaction via agent", {
			userId,
			chainId,
			transactions,
		});

		// Get agent private key for transaction creation
		const agentPrivateKey = await privyService.getWalletPrivateKey(
			wallet.agentWalletId
		);

		// Create Safe transaction
		const safeTransaction = await safeService.createSafeTransaction(
			chainId,
			walletChain.smartAccount,
			transactions,
			agentPrivateKey
		);

		// Get transaction hash for signing
		const txHash = await safeService.getTransactionHash(
			chainId,
			walletChain.smartAccount,
			safeTransaction
		);

		// Construct Safe domain and types for EIP-712 signing
		const safeDomain = {
			verifyingContract: walletChain.smartAccount,
			chainId: chainId,
		};

		const safeTypes = {
			SafeTx: [
				{ name: "to", type: "address" },
				{ name: "value", type: "uint256" },
				{ name: "data", type: "bytes" },
				{ name: "operation", type: "uint8" },
				{ name: "safeTxGas", type: "uint256" },
				{ name: "baseGas", type: "uint256" },
				{ name: "gasPrice", type: "uint256" },
				{ name: "gasToken", type: "address" },
				{ name: "refundReceiver", type: "address" },
				{ name: "nonce", type: "uint256" },
			],
		};

		// Sign with agent wallet
		const signature = await privyService.signTypedData(
			wallet.agentWalletId,
			chainId,
			safeDomain,
			safeTypes,
			safeTransaction.data
		);

		// Execute transaction
		const executionHash = await safeService.executeTransaction(
			chainId,
			walletChain.smartAccount,
			safeTransaction,
			signature,
			agentPrivateKey
		);

		console.info("Transaction executed successfully", {
			userId,
			executionHash,
		});

		return res.json({
			success: true,
			data: {
				transactionHash: executionHash,
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Execution failed:", error);
		return res.status(500).json({
			success: false,
			error: "Transaction execution failed",
			details: error instanceof Error ? error.message : "Unknown error",
		} as ApiResponse);
	}
});

/**
 * Revoke agent access
 */
router.post("/revoke", walletOperationLimit, async (req, res) => {
	try {
		// Validate input
		const { error, value } = revokeSchema.validate(req.body);
		if (error) {
			console.warn("Invalid revoke request", { error: error.details });
			return res.status(400).json({
				success: false,
				error: "Invalid input data",
				details: error.details[0]?.message || "Validation error",
			} as ApiResponse);
		}

		const { userId } = value as { userId: string };

		const wallet = await prisma.wallet.findUnique({
			where: { userId },
			include: { walletChains: true },
		});

		if (!wallet) {
			console.warn("Wallet not found for revoke", { userId });
			return res.status(404).json({
				success: false,
				error: "Wallet not found",
			} as ApiResponse);
		}

		console.info("Revoking agent access", { userId, walletId: wallet.id });

		// Get the first active wallet chain for revocation
		const walletChain = wallet.walletChains.find(
			(wc) => wc.status === "ACTIVE"
		);
		if (!walletChain || !walletChain.smartAccount) {
			return res.status(404).json({
				success: false,
				error: "Active wallet chain not found",
			} as ApiResponse);
		}

		// Create remove owner transaction
		const removeOwnerTx = await safeService.removeOwner(
			walletChain.chainId,
			walletChain.smartAccount,
			wallet.agentAddress,
			1
		);

		// Note: This transaction needs to be signed by the user, not the agent
		// Return transaction data for user to sign on frontend

		// Update status in DB
		await prisma.wallet.update({
			where: { userId },
			data: { status: "REVOKED" },
		});

		console.info("Agent access revoked successfully", { userId });

		return res.json({
			success: true,
			data: {
				transactionData: removeOwnerTx,
				message: "Agent access revoked",
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Revoke failed:", error);
		return res.status(500).json({
			success: false,
			error: "Revoke failed",
			details: error instanceof Error ? error.message : "Unknown error",
		} as ApiResponse);
	}
});

/**
 * Get wallet balance with detailed information
 */
router.get("/balance", walletOperationLimit, async (req, res) => {
	try {
		const { userId, chainId } = req.query;

		if (!userId) {
			return res.status(400).json({
				success: false,
				error: "userId required",
			} as ApiResponse);
		}

		const { createTransactionExecutor } = await import(
			"../services/transaction-executor"
		);
		const executor = createTransactionExecutor();

		const balanceInfo = await executor.getSafeBalanceInfo(
			userId as string,
			chainId ? parseInt(chainId as string) : undefined
		);

		if (!balanceInfo.success) {
			return res.status(404).json({
				success: false,
				error: balanceInfo.error || "Balance check failed",
			} as ApiResponse);
		}

		return res.json({
			success: true,
			data: {
				balance: balanceInfo.balance,
				balanceRBTC: balanceInfo.balanceRBTC,
				safeAddress: balanceInfo.safeAddress,
				chainId: balanceInfo.chainId,
				fundingInstructions:
					balanceInfo.balanceRBTC === "0"
						? {
								message:
									"Safe contract has no balance. Please fund it to enable transactions.",
								safeAddress: balanceInfo.safeAddress,
								chainId: balanceInfo.chainId,
								recommendedAmount: "0.01", // 0.01 RBTC minimum
						  }
						: undefined,
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Balance check failed:", error);
		return res.status(500).json({
			success: false,
			error: "Balance check failed",
			details: error instanceof Error ? error.message : "Unknown error",
		} as ApiResponse);
	}
});

/**
 * Execute transaction from calendar event (for testing/manual execution)
 */
router.post("/execute-event", walletOperationLimit, async (req, res) => {
	try {
		const { eventId } = req.body;

		if (!eventId) {
			return res.status(400).json({
				success: false,
				error: "eventId required",
			} as ApiResponse);
		}

		const { createTransactionExecutor } = await import(
			"../services/transaction-executor"
		);
		const executor = createTransactionExecutor();

		const result = await executor.executeTransactionFromEvent(eventId);

		if (result.success) {
			return res.json({
				success: true,
				data: {
					transactionHash: result.transactionHash,
					message: "Transaction executed successfully",
				},
			} as ApiResponse);
		} else {
			return res.status(400).json({
				success: false,
				error: result.error || "Transaction execution failed",
			} as ApiResponse);
		}
	} catch (error) {
		console.error("Event execution failed:", error);
		return res.status(500).json({
			success: false,
			error: "Event execution failed",
			details: error instanceof Error ? error.message : "Unknown error",
		} as ApiResponse);
	}
});

/**
 * Process all scheduled transactions (for testing/manual trigger)
 */
router.post("/process-scheduled", walletOperationLimit, async (req, res) => {
	try {
		const { createTransactionExecutor } = await import(
			"../services/transaction-executor"
		);
		const executor = createTransactionExecutor();

		const result = await executor.processScheduledTransactions();

		return res.json({
			success: true,
			data: {
				processed: result.processed,
				successful: result.successful,
				failed: result.failed,
				message: "Scheduled transactions processed",
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Scheduled processing failed:", error);
		return res.status(500).json({
			success: false,
			error: "Scheduled processing failed",
			details: error instanceof Error ? error.message : "Unknown error",
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

		console.info("Redeploying Safe contract", {
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

		console.info("Safe contract redeployed successfully", {
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

/**
 * Manually fund a smart account with deployer funds (for testing/emergency)
 */
router.post("/fund-smart-account", walletOperationLimit, async (req, res) => {
	try {
		const { userId, chainId, amount } = req.body;

		if (!userId) {
			return res.status(400).json({
				success: false,
				error: "userId required",
			} as ApiResponse);
		}

		if (!chainId) {
			return res.status(400).json({
				success: false,
				error: "chainId required",
			} as ApiResponse);
		}

		const wallet = await prisma.wallet.findUnique({
			where: { userId },
			include: {
				walletChains: {
					where: { chainId: parseInt(chainId), status: "ACTIVE" },
				},
			},
		});

		if (!wallet || wallet.status !== "ACTIVE") {
			return res.status(404).json({
				success: false,
				error: "Active wallet not found",
			} as ApiResponse);
		}

		const walletChain = wallet.walletChains[0];
		if (!walletChain || !walletChain.smartAccount) {
			return res.status(404).json({
				success: false,
				error: `Active wallet chain not found for chain ${chainId}`,
			} as ApiResponse);
		}

		console.info("Manual funding request", {
			userId,
			chainId,
			smartAccount: walletChain.smartAccount,
			requestedAmount: amount,
		});

		// Use the appropriate service based on chain support
		let fundingResult;
		if (safeService.isSafeCompatible(parseInt(chainId))) {
			// For Safe-compatible chains, use direct funding approach
			const chainConfig = safeService.getChainConfiguration(
				parseInt(chainId)
			);
			const { ethers } = await import("ethers");

			const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
			const deployerSigner = new ethers.Wallet(
				chainConfig.deployerPrivateKey,
				provider
			);

			const fundingAmount = amount || "100000000000000000"; // 0.1 ETH equivalent

			const fundingTx = await deployerSigner.sendTransaction({
				to: walletChain.smartAccount,
				value: BigInt(fundingAmount),
			});

			await fundingTx.wait();

			fundingResult = {
				success: true,
				transactionHash: fundingTx.hash,
			};
		} else {
			// For custom smart accounts, use the direct funding approach
			const chainConfig = customSmartAccountService.getChainConfiguration(
				parseInt(chainId)
			);
			const { ethers } = await import("ethers");

			const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
			const deployerSigner = new ethers.Wallet(
				chainConfig.deployerPrivateKey,
				provider
			);

			const fundingAmount = amount || "100000000000000000"; // 0.1 ETH equivalent

			const fundingTx = await deployerSigner.sendTransaction({
				to: walletChain.smartAccount,
				value: BigInt(fundingAmount),
			});

			await fundingTx.wait();

			fundingResult = {
				success: true,
				transactionHash: fundingTx.hash,
			};
		}

		if (fundingResult.success) {
			return res.json({
				success: true,
				data: {
					smartAccount: walletChain.smartAccount,
					chainId: parseInt(chainId),
					transactionHash: fundingResult.transactionHash,
					message: "Smart account funded successfully",
				},
			} as ApiResponse);
		} else {
			return res.status(500).json({
				success: false,
				error: "Funding failed",
			} as ApiResponse);
		}
	} catch (error) {
		console.error("Manual funding failed:", error);
		return res.status(500).json({
			success: false,
			error: "Manual funding failed",
			details: error instanceof Error ? error.message : "Unknown error",
		} as ApiResponse);
	}
});

export default router;
