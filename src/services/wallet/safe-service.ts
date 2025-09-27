import Safe, {
	SafeAccountConfig,
	PredictedSafeProps,
} from "@safe-global/protocol-kit";
import {
	EthSafeTransaction,
	EthSafeSignature,
} from "@safe-global/protocol-kit";
import { ethers } from "ethers";
import { config } from "../../config";
import { ChainConfig } from "../../types";

export class SafeService {
	private readonly chainConfigs: Map<number, ChainConfig>;
	private readonly providers: Map<number, ethers.Provider>;
	private readonly deployerSigners: Map<number, ethers.Wallet>;

	constructor() {
		this.chainConfigs = new Map();
		this.providers = new Map();
		this.deployerSigners = new Map();

		// Initialize providers and signers for each chain
		config.chains.forEach((chainConfig) => {
			this.chainConfigs.set(chainConfig.chainId, chainConfig);

			const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
			this.providers.set(chainConfig.chainId, provider);

			const deployerSigner = new ethers.Wallet(
				chainConfig.deployerPrivateKey,
				provider
			);
			this.deployerSigners.set(chainConfig.chainId, deployerSigner);
		});
	}

	private getChainConfig(chainId: number): ChainConfig {
		const chainConfig = this.chainConfigs.get(chainId);
		if (!chainConfig) {
			throw new Error(`Chain ${chainId} not configured`);
		}
		return chainConfig;
	}

	private getProvider(chainId: number): ethers.Provider {
		const provider = this.providers.get(chainId);
		if (!provider) {
			throw new Error(`Provider for chain ${chainId} not found`);
		}
		return provider;
	}

	private getDeployerSigner(chainId: number): ethers.Wallet {
		const signer = this.deployerSigners.get(chainId);
		if (!signer) {
			throw new Error(`Deployer signer for chain ${chainId} not found`);
		}
		return signer;
	}

	/**
	 * Deploys a new Safe with specified owners on the given chain
	 */
	async deploySafe(
		chainId: number,
		owners: string[],
		threshold: number = 1
	): Promise<string> {
		try {
			console.info("Deploying Safe with owners", {
				chainId,
				owners,
				threshold,
			});

			const deployerSigner = this.getDeployerSigner(chainId);

			// Ensure addresses are properly checksummed
			const checksummedOwners = owners.map((owner) =>
				ethers.getAddress(owner.toLowerCase())
			);

			const safeAccountConfig: SafeAccountConfig = {
				owners: checksummedOwners,
				threshold,
			};

			// Create predicted Safe props for deployment
			const predictedSafe: PredictedSafeProps = {
				safeAccountConfig,
			};

			// Initialize Safe SDK with predicted configuration
			const safeSdk = await Safe.init({
				provider: this.getChainConfig(chainId).rpcUrl,
				signer: deployerSigner.privateKey,
				predictedSafe,
			});

			// Get the predicted Safe address
			const safeAddress = await safeSdk.getAddress();
			console.info("Predicted Safe address", {
				chainId,
				safeAddress,
			});

			// Check if Safe is already deployed at this address
			const provider = new ethers.JsonRpcProvider(
				this.getChainConfig(chainId).rpcUrl
			);
			const existingCode = await provider.getCode(safeAddress);

			if (existingCode !== "0x") {
				console.info("Safe already deployed at predicted address", {
					chainId,
					safeAddress,
					codeLength: existingCode.length,
				});
				return safeAddress;
			}

			// Create deployment transaction
			const deploymentTransaction =
				await safeSdk.createSafeDeploymentTransaction();

			// Execute the deployment transaction
			const txResponse = await deployerSigner.sendTransaction({
				to: deploymentTransaction.to,
				data: deploymentTransaction.data,
				value: deploymentTransaction.value
					? BigInt(deploymentTransaction.value)
					: 0n,
			});

			const receipt = await txResponse.wait();

			// Verify the contract was actually deployed
			const code = await provider.getCode(safeAddress);

			if (code === "0x") {
				throw new Error(
					`Safe contract was not deployed at predicted address ${safeAddress}`
				);
			}

			console.info("Safe deployed successfully", {
				chainId,
				safeAddress,
				txHash: txResponse.hash,
				receipt: receipt?.hash,
				contractCodeLength: code.length,
			});

			// Automatically fund the Safe with a small amount for initial operations
			await this.autoFundSafe(chainId, safeAddress);

			return safeAddress;
		} catch (error) {
			console.error("Safe deployment failed:", error);
			throw new Error(`Safe deployment failed on chain ${chainId}`);
		}
	}

	/**
	 * Creates a Safe transaction
	 */
	async createSafeTransaction(
		chainId: number,
		safeAddress: string,
		transactions: Array<{
			to: string;
			value: string;
			data: string;
		}>,
		agentPrivateKey: string
	): Promise<EthSafeTransaction> {
		try {
			console.info("Creating Safe transaction", {
				chainId,
				safeAddress,
				transactions,
			});

			const safeSdk = await Safe.init({
				provider: this.getChainConfig(chainId).rpcUrl,
				signer: agentPrivateKey,
				safeAddress,
			});

			const safeTransaction = await safeSdk.createTransaction({
				transactions,
				options: {
					safeTxGas: "0", // Let Safe calculate this
					baseGas: "0", // Let Safe calculate this
					gasPrice: "0", // Use network gas price
					gasToken: ethers.ZeroAddress,
					refundReceiver: ethers.ZeroAddress,
				},
			});

			console.info("Safe transaction created successfully", {
				chainId,
				safeAddress,
				transactions: transactions,
				safeTransactionData: safeTransaction.data,
			});
			return safeTransaction;
		} catch (error) {
			console.error("Failed to create Safe transaction:", {
				error: error instanceof Error ? error.message : error,
				stack: error instanceof Error ? error.stack : undefined,
				chainId,
				safeAddress,
				transactions,
			});
			throw new Error(
				`Safe transaction creation failed on chain ${chainId}: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}
	}

	/**
	 * Executes a Safe transaction with provided signature
	 */
	async executeTransaction(
		chainId: number,
		safeAddress: string,
		safeTransaction: EthSafeTransaction,
		signature: string,
		agentPrivateKey: string
	): Promise<string> {
		try {
			console.info("Executing Safe transaction", {
				chainId,
				safeAddress,
			});

			const provider = this.getProvider(chainId);

			// Create agent signer from the provided private key
			const agentSigner = new ethers.Wallet(agentPrivateKey, provider);

			console.info("Safe.init parameters", {
				chainId,
				signerAddress: agentSigner.address,
				signerPrivateKey: agentPrivateKey ? "***SET***" : "UNDEFINED",
				safeAddress,
			});

			const safeSdk = await Safe.init({
				provider: this.getChainConfig(chainId).rpcUrl,
				signer: agentPrivateKey,
				safeAddress,
			});

			// Add signature to transaction
			console.info("Adding signature to Safe transaction", {
				chainId,
				signature,
				signatureLength: signature.length,
				signatureType: typeof signature,
				signerAddress: agentSigner.address,
			});

			// Add signature to transaction
			const safeSignature = new EthSafeSignature(
				agentSigner.address,
				signature
			);
			safeTransaction.addSignature(safeSignature);

			// Execute the transaction
			const executeTxResponse = await safeSdk.executeTransaction(
				safeTransaction
			);
			if (
				executeTxResponse.transactionResponse &&
				typeof executeTxResponse.transactionResponse === "object" &&
				"wait" in executeTxResponse.transactionResponse
			) {
				await (executeTxResponse.transactionResponse as any).wait();
			}

			console.info("Safe transaction executed successfully", {
				chainId,
				safeAddress,
				txHash: executeTxResponse.hash,
			});

			return executeTxResponse.hash;
		} catch (error) {
			console.error("Failed to execute Safe transaction:", error);
			throw new Error(
				`Safe transaction execution failed on chain ${chainId}`
			);
		}
	}

	/**
	 * Removes an owner from the Safe
	 */
	async removeOwner(
		chainId: number,
		safeAddress: string,
		ownerToRemove: string,
		newThreshold: number
	): Promise<EthSafeTransaction> {
		try {
			console.info("Creating remove owner transaction", {
				chainId,
				safeAddress,
				ownerToRemove,
				newThreshold,
			});

			const deployerSigner = this.getDeployerSigner(chainId);

			const safeSdk = await Safe.init({
				provider: this.getChainConfig(chainId).rpcUrl,
				signer: deployerSigner.privateKey,
				safeAddress,
			});

			const removeOwnerTx = await safeSdk.createRemoveOwnerTx({
				ownerAddress: ownerToRemove,
				threshold: newThreshold,
			});

			console.info("Remove owner transaction created successfully", {
				chainId,
				safeAddress,
				ownerToRemove,
			});

			return removeOwnerTx;
		} catch (error) {
			console.error("Failed to create remove owner transaction:", error);
			throw new Error(
				`Remove owner transaction creation failed on chain ${chainId}`
			);
		}
	}

	/**
	 * Check if a Safe is deployed at the given address
	 */
	async isSafeDeployed(
		chainId: number,
		safeAddress: string
	): Promise<boolean> {
		try {
			const provider = this.getProvider(chainId);

			// Check if there's code at the address
			const code = await provider.getCode(safeAddress);
			if (code === "0x") {
				console.warn("No contract code found at Safe address", {
					chainId,
					safeAddress,
				});
				return false;
			}

			// Try to initialize Safe SDK to verify it's a valid Safe
			try {
				const safeSdk = await Safe.init({
					provider: this.getChainConfig(chainId).rpcUrl,
					safeAddress,
				});

				// Try to get owners to verify it's a valid Safe
				await safeSdk.getOwners();
				return true;
			} catch (error) {
				console.warn(
					"Safe initialization failed - contract may not be a Safe",
					{
						chainId,
						safeAddress,
						error: error instanceof Error ? error.message : error,
					}
				);
				return false;
			}
		} catch (error) {
			console.error("Failed to check Safe deployment status:", error);
			return false;
		}
	}

	/**
	 * Get Safe balance
	 */
	async getBalance(chainId: number, safeAddress: string): Promise<string> {
		try {
			const provider = this.getProvider(chainId);
			const balance = await provider.getBalance(safeAddress);
			return balance.toString();
		} catch (error) {
			console.error("Failed to get Safe balance:", error);
			throw new Error(`Balance check failed on chain ${chainId}`);
		}
	}

	/**
	 * Get Safe owners
	 */
	async getOwners(chainId: number, safeAddress: string): Promise<string[]> {
		try {
			const safeSdk = await Safe.init({
				provider: this.getChainConfig(chainId).rpcUrl,
				safeAddress,
			});

			return await safeSdk.getOwners();
		} catch (error) {
			console.error("Failed to get Safe owners:", error);
			throw new Error(`Owners retrieval failed on chain ${chainId}`);
		}
	}

	/**
	 * Get Safe threshold
	 */
	async getThreshold(chainId: number, safeAddress: string): Promise<number> {
		try {
			const safeSdk = await Safe.init({
				provider: this.getChainConfig(chainId).rpcUrl,
				safeAddress,
			});

			return await safeSdk.getThreshold();
		} catch (error) {
			console.error("Failed to get Safe threshold:", error);
			throw new Error(`Threshold retrieval failed on chain ${chainId}`);
		}
	}

	/**
	 * Get transaction hash for signing
	 */
	async getTransactionHash(
		chainId: number,
		safeAddress: string,
		safeTransaction: EthSafeTransaction
	): Promise<string> {
		try {
			const safeSdk = await Safe.init({
				provider: this.getChainConfig(chainId).rpcUrl,
				safeAddress,
			});

			return await safeSdk.getTransactionHash(safeTransaction);
		} catch (error) {
			console.error("Failed to get transaction hash:", error);
			throw new Error(
				`Transaction hash retrieval failed on chain ${chainId}`
			);
		}
	}

	/**
	 * Get supported chain IDs
	 */
	getSupportedChainIds(): number[] {
		return Array.from(this.chainConfigs.keys());
	}

	/**
	 * Get chain configuration
	 */
	getChainConfiguration(chainId: number): ChainConfig {
		return this.getChainConfig(chainId);
	}

	/**
	 * Check if a chain is Safe-compatible
	 */
	isSafeCompatible(chainId: number): boolean {
		const config = this.chainConfigs.get(chainId);
		return config?.safeSupported !== false; // Default to true if not specified
	}

	/**
	 * Get provider for a specific chain (public method for external access)
	 */
	getProviderPublic(chainId: number): ethers.Provider {
		return this.getProvider(chainId);
	}

	/**
	 * Automatically fund a newly deployed Safe with a small amount for initial operations
	 */
	private async autoFundSafe(
		chainId: number,
		safeAddress: string
	): Promise<void> {
		try {
			console.info("Auto-funding Safe contract", {
				chainId,
				safeAddress,
			});

			const deployerSigner = this.getDeployerSigner(chainId);
			const provider = this.getProvider(chainId);

			// Check deployer balance first
			const deployerBalance = await provider.getBalance(
				deployerSigner.address
			);

			// Define funding amounts per chain (in wei)
			const fundingAmounts: Record<number, bigint> = {
				31: BigInt("10000000000000000"), // Rootstock Testnet: 0.01 RBTC
				30: BigInt("10000000000000000"), // Rootstock Mainnet: 0.01 RBTC
				11155111: BigInt("10000000000000000"), // Sepolia: 0.01 ETH
				545: BigInt("100000000000000000"), // Flow EVM: 0.1 FLOW (more generous for testing)
			};

			const fundingAmount =
				fundingAmounts[chainId] || BigInt("10000000000000000"); // Default 0.01 ETH

			if (deployerBalance < fundingAmount) {
				console.warn(
					"Deployer has insufficient balance for auto-funding",
					{
						chainId,
						deployerAddress: deployerSigner.address,
						deployerBalance: deployerBalance.toString(),
						requiredFunding: fundingAmount.toString(),
					}
				);
				// Don't throw error, just log warning and continue
				return;
			}

			// Check if Safe already has sufficient balance
			const currentBalance = await provider.getBalance(safeAddress);
			if (currentBalance >= fundingAmount / 2n) {
				// If it has at least half the funding amount
				console.info(
					"Safe already has sufficient balance, skipping auto-funding",
					{
						chainId,
						safeAddress,
						currentBalance: currentBalance.toString(),
					}
				);
				return;
			}

			// Send funding transaction
			const fundingTx = await deployerSigner.sendTransaction({
				to: safeAddress,
				value: fundingAmount,
				// Use higher gas limit for funding transaction
				gasLimit: 21000,
			});

			console.info("Auto-funding transaction sent", {
				chainId,
				safeAddress,
				fundingAmount: fundingAmount.toString(),
				txHash: fundingTx.hash,
				deployerAddress: deployerSigner.address,
			});

			// Wait for confirmation
			const receipt = await fundingTx.wait();

			if (receipt && receipt.status === 1) {
				const newBalance = await provider.getBalance(safeAddress);
				console.info("Safe auto-funding completed successfully", {
					chainId,
					safeAddress,
					fundingAmount: fundingAmount.toString(),
					newBalance: newBalance.toString(),
					txHash: fundingTx.hash,
					blockNumber: receipt.blockNumber,
				});
			} else {
				console.warn("Auto-funding transaction failed", {
					chainId,
					safeAddress,
					txHash: fundingTx.hash,
					status: receipt?.status,
				});
			}
		} catch (error) {
			console.error("Auto-funding Safe failed (non-critical)", {
				error: error instanceof Error ? error.message : error,
				chainId,
				safeAddress,
			});
			// Don't throw error - funding failure shouldn't break deployment
		}
	}
}
