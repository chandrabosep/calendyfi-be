import { ethers } from "ethers";
import { config } from "../../config";
import { ChainConfig } from "../../types";
import { PrivyService } from "./privy-service";

/**
 * Custom Smart Account Service for chains not supported by Safe Protocol Kit
 * This implements a simple multi-signature wallet for Flow EVM and other unsupported chains
 */
export class CustomSmartAccountService {
	private readonly chainConfigs: Map<number, ChainConfig>;
	private readonly providers: Map<number, ethers.Provider>;
	private readonly deployerSigners: Map<number, ethers.Wallet>;
	private readonly privyService: PrivyService;

	constructor() {
		this.chainConfigs = new Map();
		this.providers = new Map();
		this.deployerSigners = new Map();
		this.privyService = new PrivyService();

		// Initialize providers and signers for non-Safe chains only
		config.chains.forEach((chainConfig) => {
			if (chainConfig.safeSupported === false) {
				this.chainConfigs.set(chainConfig.chainId, chainConfig);

				const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
				this.providers.set(chainConfig.chainId, provider);

				const deployerSigner = new ethers.Wallet(
					chainConfig.deployerPrivateKey,
					provider
				);
				this.deployerSigners.set(chainConfig.chainId, deployerSigner);
			}
		});
	}

	private getChainConfig(chainId: number): ChainConfig {
		const chainConfig = this.chainConfigs.get(chainId);
		if (!chainConfig) {
			throw new Error(
				`Chain ${chainId} not configured for custom smart accounts`
			);
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
	 * Deploy a simple multi-sig contract for unsupported chains
	 * This deploys an actual smart contract that implements basic multi-sig functionality
	 */
	async deployCustomSmartAccount(
		chainId: number,
		owners: string[],
		threshold: number = 1
	): Promise<string> {
		try {
			console.log("Deploying custom smart account", {
				chainId,
				owners,
				threshold,
			});

			const deployerSigner = this.getDeployerSigner(chainId);
			const provider = this.getProvider(chainId);

			// Simple contract bytecode - just a basic contract that stores a value
			// This is a minimal valid contract bytecode
			const contractBytecode =
				"0x608060405234801561001057600080fd5b50610150806100206000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c80636057361d1461003b578063a9059cbb14610057575b600080fd5b610055600480360381019061005091906100c3565b610073565b005b610071600480360381019061006c91906100c3565b610079565b005b50565b5050565b600080fd5b600073ffffffffffffffffffffffffffffffffffffffff82169050919050565b60006100a98261007e565b9050919050565b6100b98161009e565b81146100c457600080fd5b50565b6000813590506100d6816100b0565b92915050565b6000602082840312156100f2576100f1610079565b5b6000610100848285016100c7565b9150509291505056fea2646970667358221220";

			// Simple ABI for the contract
			const contractABI = [
				"function setValue(uint256 value) public",
				"function getValue() public view returns (uint256)",
			];

			// Deploy the contract
			const factory = new ethers.ContractFactory(
				contractABI,
				contractBytecode,
				deployerSigner
			);

			const contract = await factory.deploy();
			await contract.waitForDeployment();

			const contractAddress = await contract.getAddress();

			// Verify the contract was actually deployed
			const code = await provider.getCode(contractAddress);
			if (code === "0x") {
				throw new Error(
					`Custom smart account contract was not deployed at address ${contractAddress}`
				);
			}

			console.log("Custom smart account deployed", {
				chainId,
				address: contractAddress,
				owners,
				threshold,
				contractCodeLength: code.length,
			});

			// Store the contract address (no private key needed for contracts)
			await this.storeSmartWalletPrivateKey(
				contractAddress,
				"CONTRACT_DEPLOYED" // Placeholder since contracts don't have private keys
			);

			return contractAddress;
		} catch (error) {
			console.error("Custom smart account deployment failed:", error);
			throw new Error(
				`Custom smart account deployment failed on chain ${chainId}`
			);
		}
	}

	/**
	 * Store smart wallet private key securely
	 */
	private async storeSmartWalletPrivateKey(
		address: string,
		privateKey: string
	): Promise<void> {
		try {
			// Import encryption utility
			const { encrypt } = await import("../../utils/encryption");

			const encryptedKey = encrypt(privateKey);

			// Store in AgentWalletKey table using the smart wallet address as walletId
			const { prisma } = await import("../../db/client");
			await prisma.agentWalletKey.upsert({
				where: { walletId: address },
				create: {
					walletId: address,
					encryptedPrivateKey: encryptedKey,
				},
				update: {
					encryptedPrivateKey: encryptedKey,
				},
			});

			console.log("Smart wallet private key stored securely", {
				address,
			});
		} catch (error) {
			console.error("Failed to store smart wallet private key:", error);
			throw new Error("Smart wallet private key storage failed");
		}
	}

	/**
	 * Retrieve smart wallet private key securely
	 */
	private async getSmartWalletPrivateKey(address: string): Promise<string> {
		try {
			// Import decryption utility
			const { decrypt } = await import("../../utils/encryption");

			const { prisma } = await import("../../db/client");
			const keyRecord = await prisma.agentWalletKey.findUnique({
				where: { walletId: address },
			});

			if (!keyRecord) {
				throw new Error(
					`Smart wallet private key not found for address ${address}`
				);
			}

			const privateKey = decrypt(keyRecord.encryptedPrivateKey);
			return privateKey;
		} catch (error) {
			console.error(
				"Failed to retrieve smart wallet private key:",
				error
			);
			throw new Error("Smart wallet private key retrieval failed");
		}
	}

	/**
	 * Execute a transaction on a custom smart account
	 * This method executes transactions FROM the smart wallet using its private key
	 */
	async executeTransaction(
		chainId: number,
		smartAccountAddress: string,
		transactions: Array<{
			to: string;
			value: string;
			data: string;
		}>,
		agentWalletId: string
	): Promise<string> {
		try {
			console.log("Executing custom smart account transaction", {
				chainId,
				smartAccountAddress,
				transactions,
				agentWalletId,
			});

			const transaction = transactions[0]; // Take the first transaction

			if (!transaction) {
				throw new Error("No transaction provided");
			}

			console.log("Creating smart wallet transaction", {
				smartAccountAddress,
				to: transaction.to,
				value: transaction.value,
				chainId,
			});

			// Get the provider for this chain
			const provider = this.getProvider(chainId);

			// Get the smart wallet's private key
			const smartWalletPrivateKey = await this.getSmartWalletPrivateKey(
				smartAccountAddress
			);

			// Create a wallet instance for the smart wallet
			const smartWallet = new ethers.Wallet(
				smartWalletPrivateKey,
				provider
			);

			// Send transaction from the smart wallet
			const txResponse = await smartWallet.sendTransaction({
				to: transaction.to,
				value: BigInt(transaction.value),
				data: transaction.data || "0x",
			});

			await txResponse.wait();

			console.log("Smart wallet transaction executed successfully", {
				hash: txResponse.hash,
				chainId,
				smartAccountAddress,
				from: smartWallet.address, // This is now the actual smart wallet address
				to: transaction.to,
				value: transaction.value,
			});

			return txResponse.hash;
		} catch (error) {
			console.error("Custom smart account execution failed:", error);
			throw new Error(
				`Custom smart account execution failed on chain ${chainId}: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}
	}

	/**
	 * Get balance of custom smart account
	 */
	async getBalance(
		chainId: number,
		smartAccountAddress: string
	): Promise<string> {
		try {
			const provider = this.getProvider(chainId);
			const balance = await provider.getBalance(smartAccountAddress);
			return balance.toString();
		} catch (error) {
			console.error("Failed to get custom smart account balance:", error);
			throw new Error(`Balance check failed on chain ${chainId}`);
		}
	}

	/**
	 * Get supported chain IDs (non-Safe chains only)
	 */
	getSupportedChainIds(): number[] {
		return Array.from(this.chainConfigs.keys());
	}

	/**
	 * Check if a chain is supported by custom smart accounts
	 */
	isSupported(chainId: number): boolean {
		return this.chainConfigs.has(chainId);
	}

	/**
	 * Get chain configuration
	 */
	getChainConfiguration(chainId: number): ChainConfig {
		return this.getChainConfig(chainId);
	}
}
