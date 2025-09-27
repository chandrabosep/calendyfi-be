import { prisma, withRetry } from "../db/client";
import { PrivyService } from "./wallet/privy-service";
import { SafeService } from "./wallet/safe-service";
import { CustomSmartAccountService } from "./wallet/custom-smart-account-service";
import { TokenService, TokenTransfer } from "./token-service";
import { NameResolutionService } from "./name-resolution-service";
import { ethers } from "ethers";
import { Prisma } from "@prisma/client";

export class TransactionExecutor {
	private privyService: PrivyService;
	private safeService: SafeService;
	private customSmartAccountService: CustomSmartAccountService;
	private tokenService: TokenService;
	private nameResolutionService: NameResolutionService;

	constructor() {
		this.privyService = new PrivyService();
		this.safeService = new SafeService();
		this.customSmartAccountService = new CustomSmartAccountService();
		this.tokenService = new TokenService();
		this.nameResolutionService = new NameResolutionService();
	}

	/**
	 * Execute a transaction from a calendar event
	 */
	async executeTransactionFromEvent(eventId: string): Promise<{
		success: boolean;
		transactionHash?: string;
		error?: string;
	}> {
		try {
			console.info("Executing transaction from event", { eventId });

			// Get the event with parsed data
			const event = await prisma.calendarEvent.findUnique({
				where: { id: eventId },
				include: { user: true },
			});

			if (!event) {
				return { success: false, error: "Event not found" };
			}

			if (!event.isAiEvent) {
				return { success: false, error: "Event is not an AI event" };
			}

			if (!event.parsedAction || !event.parsedAmount) {
				return {
					success: false,
					error: "Event missing required parsed data",
				};
			}

			// Get user's wallet with chain information
			const wallet = await prisma.wallet.findUnique({
				where: { userId: event.userId },
				include: {
					walletChains: {
						where: { status: "ACTIVE" },
					},
				},
			});

			if (!wallet || wallet.status !== "ACTIVE") {
				return { success: false, error: "Active wallet not found" };
			}

			// Select the correct chain based on the parsed command
			let walletChain = wallet.walletChains[0]; // Default to first chain

			// If the event specifies a chain, try to find the matching wallet chain
			if (event.parsedChain) {
				const chainName = event.parsedChain.toLowerCase();
				let targetChainId: number | null = null;

				// Map chain names to chain IDs
				if (chainName === "flow" || chainName === "flow evm") {
					targetChainId = 545; // Flow EVM Testnet (correct chain ID)
				} else if (
					chainName === "sepolia" ||
					chainName === "ethereum"
				) {
					targetChainId = 11155111; // Sepolia Testnet
				} else if (chainName === "rootstock" || chainName === "rsk") {
					targetChainId = 31; // Rootstock Testnet (default to testnet)
				} else if (
					chainName === "rootstock mainnet" ||
					chainName === "rsk mainnet"
				) {
					targetChainId = 30; // Rootstock Mainnet
				}

				if (targetChainId) {
					const matchingChain = wallet.walletChains.find(
						(wc) =>
							wc.chainId === targetChainId &&
							wc.status === "ACTIVE"
					);
					if (matchingChain) {
						walletChain = matchingChain;
						console.info("Selected chain based on AI command", {
							requestedChain: event.parsedChain,
							selectedChainId: walletChain.chainId,
							smartAccount: walletChain.smartAccount,
						});
					} else {
						console.warn(
							"Requested chain not available, using default",
							{
								requestedChain: event.parsedChain,
								targetChainId,
								availableChains: wallet.walletChains.map(
									(wc) => wc.chainId
								),
							}
						);
					}
				}
			}

			if (!walletChain || !walletChain.smartAccount) {
				return {
					success: false,
					error: "No active wallet chain found",
				};
			}

			// Build transaction based on parsed data
			const transaction = await this.buildTransactionFromEvent(event);
			if (!transaction) {
				return { success: false, error: "Failed to build transaction" };
			}

			// Execute the transaction
			const result = await this.executeTransaction(
				wallet,
				walletChain,
				transaction
			);

			// Update event status
			await prisma.calendarEvent.update({
				where: { id: eventId },
				data: {
					isExecuted: true,
					executionHash: result.transactionHash,
					executedAt: new Date(),
				},
			});

			console.info("Transaction executed successfully", {
				eventId,
				transactionHash: result.transactionHash,
			});

			return result;
		} catch (error) {
			console.error("Failed to execute transaction from event", {
				error,
				eventId,
			});

			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	/**
	 * Build transaction object from parsed event data
	 */
	private async buildTransactionFromEvent(event: any): Promise<{
		to: string;
		value: string;
		data: string;
	} | null> {
		try {
			const {
				parsedAction,
				parsedAmount,
				parsedRecipient,
				parsedFromToken,
				parsedToToken,
				parsedChain,
			} = event;

			// Determine chain ID
			const chainId = this.getChainIdFromParsedChain(parsedChain);

			switch (parsedAction) {
				case "transfer":
				case "send":
					return await this.buildTransferTransaction(
						parsedAmount,
						parsedRecipient,
						parsedFromToken,
						chainId
					);

				case "swap":
					// For now, return null - swap implementation would require DEX integration
					console.warn("Swap transactions not yet implemented");
					return null;

				default:
					console.warn("Unknown transaction type", { parsedAction });
					return null;
			}
		} catch (error) {
			console.error("Failed to build transaction from event", {
				error: error instanceof Error ? error.message : error,
				stack: error instanceof Error ? error.stack : undefined,
				event: {
					id: event.id,
					parsedAction: event.parsedAction,
					parsedAmount: event.parsedAmount,
					parsedRecipient: event.parsedRecipient,
					parsedFromToken: event.parsedFromToken,
					parsedChain: event.parsedChain,
				},
			});
			return null;
		}
	}

	/**
	 * Build transfer transaction with token and name resolution support
	 */
	private async buildTransferTransaction(
		parsedAmount: any,
		parsedRecipient: any,
		parsedFromToken: string,
		chainId: number
	): Promise<{ to: string; value: string; data: string } | null> {
		try {
			if (!parsedRecipient || !parsedAmount) {
				console.warn("Missing required fields for transfer", {
					parsedRecipient,
					parsedAmount,
				});
				return null;
			}

			// Parse recipient data
			let parsedRecipientObj = parsedRecipient;
			if (typeof parsedRecipient === "string") {
				try {
					parsedRecipientObj = JSON.parse(parsedRecipient);
				} catch (error) {
					console.warn("Failed to parse recipient JSON", {
						parsedRecipient,
					});
					return null;
				}
			}

			// Parse amount data
			let parsedAmountObj = parsedAmount;
			if (typeof parsedAmount === "string") {
				try {
					parsedAmountObj = JSON.parse(parsedAmount);
				} catch (error) {
					console.warn("Failed to parse amount JSON", {
						parsedAmount,
					});
					return null;
				}
			}

			// Extract recipient information
			const recipientInput =
				typeof parsedRecipientObj === "object"
					? parsedRecipientObj.address ||
					  parsedRecipientObj.ens ||
					  parsedRecipientObj.username
					: parsedRecipientObj;

			// Resolve recipient address (handle ENS/RNS names)
			const resolutionResult =
				await this.nameResolutionService.resolveName(
					recipientInput,
					chainId
				);

			console.info("Recipient resolution result", {
				originalInput: recipientInput,
				resolvedAddress: resolutionResult.address,
				service: resolutionResult.service,
				chainId,
			});

			// Extract amount information
			const amountValue =
				typeof parsedAmountObj === "object"
					? parsedAmountObj.value
					: parsedAmountObj;

			const currency =
				typeof parsedAmountObj === "object"
					? parsedAmountObj.currency
					: parsedFromToken;

			// Get token information
			const tokenInfo = this.tokenService.getTokenInfo(currency, chainId);
			if (!tokenInfo) {
				console.warn("Unsupported token", { currency, chainId });
				return null;
			}

			// Parse token amount
			const tokenAmount = this.tokenService.parseTokenAmount(
				amountValue.toString(),
				tokenInfo
			);

			// Build token transfer transaction
			const tokenTransfer: TokenTransfer = {
				token: tokenInfo,
				to: resolutionResult.address,
				amount: tokenAmount,
			};

			const transaction =
				this.tokenService.buildTokenTransferTransaction(tokenTransfer);

			console.info("Built token transfer transaction", {
				token: tokenInfo.symbol,
				amount: tokenAmount,
				recipient: resolutionResult.address,
				chainId,
				isNative: this.tokenService.isNativeToken(tokenInfo),
				transaction: transaction,
			});

			return transaction;
		} catch (error) {
			console.error("Failed to build transfer transaction", {
				error: error instanceof Error ? error.message : error,
				stack: error instanceof Error ? error.stack : undefined,
				parsedAmount,
				parsedRecipient,
				parsedFromToken,
				chainId,
			});
			return null;
		}
	}

	/**
	 * Get chain ID from parsed chain name
	 */
	private getChainIdFromParsedChain(parsedChain: string): number {
		if (!parsedChain) return 11155111; // Default to Sepolia Testnet

		const chainName = parsedChain.toLowerCase();

		// Always use testnet chains for development/testing
		if (chainName === "flow" || chainName === "flow evm") {
			return 545; // Flow EVM Testnet
		} else if (
			chainName === "sepolia" ||
			chainName === "ethereum" ||
			chainName === "eth"
		) {
			return 11155111; // Sepolia Testnet
		} else if (chainName === "rootstock" || chainName === "rsk") {
			return 31; // Rootstock Testnet (default to testnet)
		} else if (
			chainName === "rootstock mainnet" ||
			chainName === "rsk mainnet"
		) {
			return 30; // Rootstock Mainnet
		}

		return 11155111; // Default to Sepolia Testnet
	}

	/**
	 * Execute transaction via Safe
	 */
	private async executeTransaction(
		wallet: any,
		walletChain: any,
		transaction: { to: string; value: string; data: string }
	): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
		try {
			// Check if chain supports Safe Protocol Kit
			if (this.safeService.isSafeCompatible(walletChain.chainId)) {
				console.info("Executing transaction via Safe", {
					walletId: wallet.id,
					transaction,
					chainId: walletChain.chainId,
				});

				// Check if Safe is deployed before attempting to create transactions
				const isDeployed = await this.safeService.isSafeDeployed(
					walletChain.chainId,
					walletChain.smartAccount
				);

				if (!isDeployed) {
					console.error(
						"Safe is not deployed at the specified address",
						{
							chainId: walletChain.chainId,
							safeAddress: walletChain.smartAccount,
						}
					);
					return {
						success: false,
						error: "Safe contract is not deployed at the specified address",
					};
				}

				// Check Safe balance before executing transaction
				const balanceCheck = await this.checkSafeBalance(
					walletChain.chainId,
					walletChain.smartAccount,
					transaction
				);

				if (!balanceCheck.sufficient) {
					console.warn(
						"Insufficient Safe balance, attempting to fund",
						{
							chainId: walletChain.chainId,
							safeAddress: walletChain.smartAccount,
							currentBalance: balanceCheck.currentBalance,
							requiredAmount: balanceCheck.requiredAmount,
							gasEstimate: balanceCheck.gasEstimate,
							transferAmount: transaction.value,
						}
					);

					// Attempt to fund the Safe contract
					const fundingResult = await this.fundSafeContract(
						walletChain.chainId,
						walletChain.smartAccount,
						balanceCheck.requiredAmount
					);

					if (!fundingResult.success) {
						console.error("Failed to fund Safe contract", {
							chainId: walletChain.chainId,
							safeAddress: walletChain.smartAccount,
							fundingError: fundingResult.error,
						});

						// Provide helpful error message with funding instructions
						const currentBalanceRBTC = (
							BigInt(balanceCheck.currentBalance) /
							BigInt("1000000000000000000")
						).toString();
						const requiredAmountRBTC = (
							BigInt(balanceCheck.requiredAmount) /
							BigInt("1000000000000000000")
						).toString();
						const shortfallRBTC =
							(BigInt(balanceCheck.requiredAmount) -
								BigInt(balanceCheck.currentBalance)) /
							BigInt("1000000000000000000");

						return {
							success: false,
							error: `Insufficient Safe balance. Current: ${currentBalanceRBTC} RBTC, Required: ${requiredAmountRBTC} RBTC (including gas). Shortfall: ${shortfallRBTC.toString()} RBTC. Please fund the Safe contract at ${
								walletChain.smartAccount
							} on chain ${
								walletChain.chainId
							} with at least ${shortfallRBTC.toString()} RBTC.`,
						};
					}

					console.info("Safe contract funded successfully", {
						chainId: walletChain.chainId,
						safeAddress: walletChain.smartAccount,
						fundingTxHash: fundingResult.transactionHash,
					});
				}
			} else {
				console.info("Executing transaction via Custom Smart Account", {
					walletId: wallet.id,
					transaction,
					chainId: walletChain.chainId,
				});

				// Use Custom Smart Account Service for non-Safe chains
				return await this.executeCustomSmartAccountTransaction(
					wallet,
					walletChain,
					transaction
				);
			}

			// Get agent private key for transaction creation
			const agentPrivateKey = await this.privyService.getWalletPrivateKey(
				wallet.agentWalletId
			);

			// Create Safe transaction
			const safeTransaction =
				await this.safeService.createSafeTransaction(
					walletChain.chainId,
					walletChain.smartAccount,
					[transaction],
					agentPrivateKey
				);

			// Get transaction hash for signing
			const txHash = await this.safeService.getTransactionHash(
				walletChain.chainId,
				walletChain.smartAccount,
				safeTransaction
			);

			// Construct Safe domain and types for EIP-712 signing
			const safeDomain = {
				verifyingContract: walletChain.smartAccount,
				chainId: walletChain.chainId,
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

			console.info("Signing transaction hash", {
				txHash,
				safeDomain,
				agentWalletId: wallet.agentWalletId,
			});

			// Prepare the Safe transaction message with actual transaction data
			const safeMessage = {
				to: safeTransaction.data.to,
				value: safeTransaction.data.value,
				data: safeTransaction.data.data,
				operation: safeTransaction.data.operation,
				safeTxGas: safeTransaction.data.safeTxGas,
				baseGas: safeTransaction.data.baseGas,
				gasPrice: safeTransaction.data.gasPrice,
				gasToken: safeTransaction.data.gasToken,
				refundReceiver: safeTransaction.data.refundReceiver,
				nonce: safeTransaction.data.nonce,
			};

			console.info("Signing Safe transaction with message", {
				safeMessage,
				safeDomain,
				agentWalletId: wallet.agentWalletId,
			});

			// Sign with agent wallet
			const signature = await this.privyService.signTypedData(
				wallet.agentWalletId,
				walletChain.chainId,
				safeDomain,
				safeTypes,
				safeMessage
			);

			// Execute transaction
			const executionHash = await this.safeService.executeTransaction(
				walletChain.chainId,
				walletChain.smartAccount,
				safeTransaction,
				signature,
				agentPrivateKey
			);

			return {
				success: true,
				transactionHash: executionHash,
			};
		} catch (error) {
			console.error("Failed to execute transaction", { error });
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	/**
	 * Process all scheduled transactions that are ready to execute
	 */
	async processScheduledTransactions(): Promise<{
		processed: number;
		successful: number;
		failed: number;
	}> {
		try {
			console.info("Processing scheduled transactions");

			const now = new Date();
			const scheduledEvents = await withRetry(async () => {
				return await prisma.calendarEvent.findMany({
					where: {
						parsedScheduledTime: { lte: now },
						isExecuted: false,
						isAiEvent: true,
						AND: [
							{ parsedAction: { not: null } },
							{ parsedAmount: { not: Prisma.JsonNull } },
						],
					},
					orderBy: {
						parsedScheduledTime: "asc",
					},
				});
			});

			console.info("Found scheduled events", {
				count: scheduledEvents.length,
			});

			let successful = 0;
			let failed = 0;

			for (const event of scheduledEvents) {
				try {
					const result = await this.executeTransactionFromEvent(
						event.id
					);
					if (result.success) {
						successful++;
					} else {
						failed++;
						console.warn("Failed to execute scheduled transaction", {
							eventId: event.id,
							error: result.error,
						});
					}
				} catch (error) {
					failed++;
					console.error("Error processing scheduled event", {
						eventId: event.id,
						error,
					});
				}
			}

			console.info("Scheduled transactions processing completed", {
				processed: scheduledEvents.length,
				successful,
				failed,
			});

			return {
				processed: scheduledEvents.length,
				successful,
				failed,
			};
		} catch (error) {
			console.error("Failed to process scheduled transactions", { error });
			return { processed: 0, successful: 0, failed: 0 };
		}
	}

	/**
	 * Check Safe balance and estimate gas for transaction
	 */
	private async checkSafeBalance(
		chainId: number,
		safeAddress: string,
		transaction: { to: string; value: string; data: string }
	): Promise<{
		sufficient: boolean;
		currentBalance: string;
		requiredAmount: string;
		gasEstimate: string;
	}> {
		try {
			// Get current Safe balance
			const currentBalance = await this.safeService.getBalance(
				chainId,
				safeAddress
			);

			// Estimate gas for the transaction
			const gasEstimate = await this.estimateSafeTransactionGas(
				chainId,
				safeAddress,
				transaction
			);

			// Calculate required amount (transfer value + gas cost)
			const transferValue = BigInt(transaction.value);

			// Get appropriate gas price for the chain
			const gasPrice = await this.getGasPrice(chainId);
			const gasCost = BigInt(gasEstimate) * gasPrice;
			const requiredAmount = transferValue + gasCost;

			const sufficient = BigInt(currentBalance) >= requiredAmount;

			console.info("Safe balance check", {
				chainId,
				safeAddress,
				currentBalance,
				transferValue: transferValue.toString(),
				gasEstimate,
				gasPrice: gasPrice.toString(),
				gasPriceGwei: (Number(gasPrice) / 1e9).toFixed(2),
				gasCost: gasCost.toString(),
				requiredAmount: requiredAmount.toString(),
				sufficient,
			});

			return {
				sufficient,
				currentBalance,
				requiredAmount: requiredAmount.toString(),
				gasEstimate,
			};
		} catch (error) {
			console.error("Failed to check Safe balance", {
				error: error instanceof Error ? error.message : error,
				chainId,
				safeAddress,
			});

			// Return insufficient if we can't check balance
			return {
				sufficient: false,
				currentBalance: "0",
				requiredAmount: transaction.value,
				gasEstimate: "0",
			};
		}
	}

	/**
	 * Get appropriate gas price for the chain
	 */
	private async getGasPrice(chainId: number): Promise<bigint> {
		try {
			// Get the provider for this chain
			const provider = this.safeService.getProviderPublic(chainId);

			// Try to get current gas price from the network
			const feeData = await provider.getFeeData();

			if (feeData.gasPrice) {
				console.info("Using network gas price", {
					chainId,
					gasPrice: feeData.gasPrice.toString(),
					gasPriceGwei: (Number(feeData.gasPrice) / 1e9).toFixed(2),
				});
				return feeData.gasPrice;
			}

			// Fallback to chain-specific defaults
			const defaultGasPrices: Record<number, bigint> = {
				31: BigInt("1000000000"), // Rootstock Testnet: 1 gwei
				30: BigInt("1000000000"), // Rootstock Mainnet: 1 gwei
				11155111: BigInt("20000000000"), // Sepolia: 20 gwei
				545: BigInt("1000000000"), // Flow EVM: 1 gwei
			};

			const defaultGasPrice =
				defaultGasPrices[chainId] || BigInt("20000000000"); // 20 gwei default

			console.info("Using default gas price", {
				chainId,
				gasPrice: defaultGasPrice.toString(),
				gasPriceGwei: (Number(defaultGasPrice) / 1e9).toFixed(2),
			});

			return defaultGasPrice;
		} catch (error) {
			console.warn("Failed to get gas price, using conservative default", {
				error: error instanceof Error ? error.message : error,
				chainId,
			});

			// Conservative fallback
			return BigInt("1000000000"); // 1 gwei
		}
	}

	/**
	 * Estimate gas for Safe transaction execution
	 */
	private async estimateSafeTransactionGas(
		chainId: number,
		safeAddress: string,
		transaction: { to: string; value: string; data: string }
	): Promise<string> {
		try {
			// Create a temporary Safe transaction to estimate gas
			const tempTransaction =
				await this.safeService.createSafeTransaction(
					chainId,
					safeAddress,
					[transaction]
				);

			// Get the transaction hash
			const txHash = await this.safeService.getTransactionHash(
				chainId,
				safeAddress,
				tempTransaction
			);

			// Estimate gas using the Safe SDK
			const provider = this.safeService.getProviderPublic(chainId);
			const gasEstimate = await provider.estimateGas({
				to: safeAddress,
				data: tempTransaction.data.data,
				value: BigInt(tempTransaction.data.value),
			});

			return gasEstimate.toString();
		} catch (error) {
			console.warn("Failed to estimate gas, using default", {
				error: error instanceof Error ? error.message : error,
				chainId,
				safeAddress,
			});

			// Return a conservative gas estimate if estimation fails
			return "100000"; // 100k gas
		}
	}

	/**
	 * Fund Safe contract with native tokens from deployer wallet
	 */
	private async fundSafeContract(
		chainId: number,
		safeAddress: string,
		requiredAmount: string
	): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
		try {
			console.info("Funding Safe contract", {
				chainId,
				safeAddress,
				requiredAmount,
			});

			const provider = this.safeService.getProviderPublic(chainId);
			const chainConfig = this.safeService.getChainConfiguration(chainId);

			// Create deployer wallet
			const deployerWallet = new ethers.Wallet(
				chainConfig.deployerPrivateKey,
				provider
			);

			// Check deployer balance
			const deployerBalance = await provider.getBalance(
				deployerWallet.address
			);
			const fundingAmount =
				BigInt(requiredAmount) + BigInt("1000000000000000000"); // Add 1 RBTC buffer

			if (deployerBalance < fundingAmount) {
				console.error("Deployer wallet has insufficient balance", {
					chainId,
					deployerAddress: deployerWallet.address,
					deployerBalance: deployerBalance.toString(),
					requiredFunding: fundingAmount.toString(),
				});
				return {
					success: false,
					error: `Deployer wallet has insufficient balance. Current: ${deployerBalance.toString()} wei, Required: ${fundingAmount.toString()} wei`,
				};
			}

			// Send funding transaction
			const fundingTx = await deployerWallet.sendTransaction({
				to: safeAddress,
				value: fundingAmount,
			});

			await fundingTx.wait();

			console.info("Safe contract funded successfully", {
				chainId,
				safeAddress,
				fundingAmount: fundingAmount.toString(),
				txHash: fundingTx.hash,
			});

			return {
				success: true,
				transactionHash: fundingTx.hash,
			};
		} catch (error) {
			console.error("Failed to fund Safe contract", {
				error: error instanceof Error ? error.message : error,
				chainId,
				safeAddress,
				requiredAmount,
			});
			return {
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Unknown funding error",
			};
		}
	}

	/**
	 * Execute transaction via Custom Smart Account (for non-Safe chains)
	 */
	private async executeCustomSmartAccountTransaction(
		wallet: any,
		walletChain: any,
		transaction: { to: string; value: string; data: string }
	): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
		try {
			console.info("Executing transaction via Custom Smart Account", {
				walletId: wallet.id,
				chainId: walletChain.chainId,
				smartAccount: walletChain.smartAccount,
				transaction,
			});

			// Execute transaction using CustomSmartAccountService
			const transactionHash =
				await this.customSmartAccountService.executeTransaction(
					walletChain.chainId,
					walletChain.smartAccount,
					[transaction],
					wallet.agentWalletId
				);

			console.info(
				"Custom Smart Account transaction executed successfully",
				{
					chainId: walletChain.chainId,
					transactionHash,
				}
			);

			return {
				success: true,
				transactionHash,
			};
		} catch (error) {
			console.error("Failed to execute custom smart account transaction", {
				error,
				chainId: walletChain.chainId,
			});
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	/**
	 * Get Safe balance information for a wallet chain
	 */
	async getSafeBalanceInfo(
		userId: string,
		chainId?: number
	): Promise<{
		success: boolean;
		balance?: string;
		balanceRBTC?: string;
		safeAddress?: string;
		chainId?: number;
		error?: string;
	}> {
		try {
			// Get user's wallet
			const wallet = await prisma.wallet.findUnique({
				where: { userId },
				include: {
					walletChains: {
						where: chainId
							? { chainId, status: "ACTIVE" }
							: { status: "ACTIVE" },
					},
				},
			});

			if (!wallet || wallet.status !== "ACTIVE") {
				return { success: false, error: "Active wallet not found" };
			}

			// Use specified chain or first available chain
			const walletChain = chainId
				? wallet.walletChains.find((wc) => wc.chainId === chainId)
				: wallet.walletChains[0];

			if (!walletChain || !walletChain.smartAccount) {
				return {
					success: false,
					error: "No active wallet chain found",
				};
			}

			// Get balance
			const balance = await this.safeService.getBalance(
				walletChain.chainId,
				walletChain.smartAccount
			);

			const balanceRBTC = (
				BigInt(balance) / BigInt("1000000000000000000")
			).toString();

			return {
				success: true,
				balance,
				balanceRBTC,
				safeAddress: walletChain.smartAccount,
				chainId: walletChain.chainId,
			};
		} catch (error) {
			console.error("Failed to get Safe balance info", {
				error: error instanceof Error ? error.message : error,
				userId,
				chainId,
			});
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}
}

export function createTransactionExecutor(): TransactionExecutor {
	return new TransactionExecutor();
}
