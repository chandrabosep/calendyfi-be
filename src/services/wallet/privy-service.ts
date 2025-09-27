import { encrypt, decrypt } from "../../utils/encryption";
import { prisma } from "../../db/client";
import { config } from "../../config";

export class PrivyService {
	private walletCache: Map<string, { address: string; privateKey: string }> =
		new Map();

	constructor() {
		// Initialize wallet cache
		// Note: loadWalletCache is async but constructor cannot be async
		// The cache will be loaded when the first wallet operation is performed
	}

	/**
	 * Load wallet cache from database on startup
	 */
	private async loadWalletCache(): Promise<void> {
		try {
			const wallets = await prisma.wallet.findMany({
				where: { status: "ACTIVE" },
				select: { agentWalletId: true, agentAddress: true },
			});

			for (const wallet of wallets) {
				if (wallet.agentWalletId && wallet.agentAddress) {
					// Try to recover the private key from storage
					const privateKey = await this.getStoredPrivateKey(
						wallet.agentWalletId
					);
					if (privateKey) {
						this.walletCache.set(wallet.agentWalletId, {
							address: wallet.agentAddress,
							privateKey: privateKey,
						});
						console.log("Loaded wallet into cache", {
							walletId: wallet.agentWalletId,
							address: wallet.agentAddress,
						});
					} else {
						console.warn("No stored private key found for wallet", {
							walletId: wallet.agentWalletId,
							address: wallet.agentAddress,
						});
					}
				}
			}

			console.log("Wallet cache loaded", {
				cachedWallets: this.walletCache.size,
			});
		} catch (error) {
			console.error("Failed to load wallet cache:", error);
		}
	}

	/**
	 * Store private key securely (encrypted in database)
	 * Uses the AgentWalletKey table for persistent storage
	 */
	private async storePrivateKey(
		walletId: string,
		privateKey: string
	): Promise<void> {
		try {
			const encryptedKey = encrypt(privateKey);

			// Store encrypted key in AgentWalletKey table
			await prisma.agentWalletKey.upsert({
				where: { walletId },
				create: {
					walletId,
					encryptedPrivateKey: encryptedKey,
				},
				update: {
					encryptedPrivateKey: encryptedKey,
				},
			});

			console.log("Private key stored securely", { walletId });
		} catch (error) {
			console.error("Failed to store private key:", error);
			throw new Error("Private key storage failed");
		}
	}

	/**
	 * Retrieve private key from secure storage
	 * Uses the AgentWalletKey table for persistent storage
	 */
	private async getStoredPrivateKey(
		walletId: string
	): Promise<string | null> {
		try {
			const keyRecord = await prisma.agentWalletKey.findUnique({
				where: { walletId },
			});

			if (!keyRecord) {
				return null;
			}

			const decryptedKey = decrypt(keyRecord.encryptedPrivateKey);
			return decryptedKey;
		} catch (error) {
			console.error("Failed to retrieve private key:", error);
			return null;
		}
	}

	/**
	 * Creates a server-owned wallet for the agent
	 * Generates wallet locally and stores private key securely
	 */
	async createAgentWallet(): Promise<{
		id: string;
		address: string;
		privateKey: string;
	}> {
		try {
			console.log("Creating agent wallet locally");

			const { ethers } = await import("ethers");
			const wallet = ethers.Wallet.createRandom();

			const walletData = {
				id: `agent-${Date.now()}-${Math.random()
					.toString(36)
					.substr(2, 9)}`,
				address: wallet.address,
				privateKey: wallet.privateKey,
			};

			// Store private key securely in database
			await this.storePrivateKey(walletData.id, walletData.privateKey);

			// Store in cache for immediate use
			this.walletCache.set(walletData.id, {
				address: walletData.address,
				privateKey: walletData.privateKey,
			});

			console.log("Agent wallet created successfully", {
				walletId: walletData.id,
				address: walletData.address,
			});

			return walletData;
		} catch (error) {
			console.error("Failed to create agent wallet:", error);
			throw new Error("Agent wallet creation failed");
		}
	}

	/**
	 * Get wallet private key by ID
	 */
	async getWalletPrivateKey(walletId: string): Promise<string> {
		// Load cache if empty
		if (this.walletCache.size === 0) {
			console.log("Wallet cache is empty, loading from database");
			await this.loadWalletCache();
		}

		const cached = this.walletCache.get(walletId);
		if (cached) {
			return cached.privateKey;
		}

		// Try to recover from secure storage
		console.log("Wallet not in cache, attempting recovery from storage", {
			walletId,
		});
		const privateKey = await this.getStoredPrivateKey(walletId);

		if (privateKey) {
			// Get wallet address from database
			const wallet = await prisma.wallet.findFirst({
				where: { agentWalletId: walletId },
				select: { agentAddress: true },
			});

			if (wallet?.agentAddress) {
				// Add back to cache
				this.walletCache.set(walletId, {
					address: wallet.agentAddress,
					privateKey: privateKey,
				});

				console.log(
					"Wallet recovered from storage and added to cache",
					{ walletId }
				);
				return privateKey;
			}
		}

		// If we can't recover from storage, generate a new private key
		// This is a temporary solution until persistent storage is implemented
		console.warn(
			"Wallet not found in cache or storage, generating new private key",
			{ walletId }
		);

		// Get the wallet record to understand what we need to recreate
		const walletRecord = await prisma.wallet.findFirst({
			where: { agentWalletId: walletId },
			select: { agentAddress: true, userId: true },
		});

		if (!walletRecord) {
			throw new Error(`Wallet ${walletId} not found in database`);
		}

		// Generate a new private key
		const { ethers } = await import("ethers");
		const newWallet = ethers.Wallet.createRandom();

		console.log("Generated new private key for wallet", {
			walletId,
			oldAddress: walletRecord.agentAddress,
			newAddress: newWallet.address,
		});

		// Update the wallet record with the new address
		await prisma.wallet.update({
			where: { agentWalletId: walletId },
			data: {
				agentAddress: newWallet.address,
			},
		});

		// Add to cache
		this.walletCache.set(walletId, {
			address: newWallet.address,
			privateKey: newWallet.privateKey,
		});

		console.log("Wallet updated and added to cache", { walletId });

		return newWallet.privateKey;
	}

	/**
	 * Signs typed data using the agent wallet
	 */
	async signTypedData(
		walletId: string,
		chainId: number,
		domain: any,
		types: any,
		message: any
	): Promise<string> {
		try {
			console.log("Signing typed data with agent wallet", {
				walletId,
				chainId,
				domain,
				types,
				message,
			});

			const privateKey = await this.getWalletPrivateKey(walletId);
			const { ethers } = await import("ethers");

			// Get the RPC URL for the specific chain
			const chainConfig = config.chains.find(
				(c) => c.chainId === chainId
			);
			if (!chainConfig) {
				throw new Error(`Chain ${chainId} not configured`);
			}

			// Create provider to avoid ENS resolution issues
			const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
			const wallet = new ethers.Wallet(privateKey, provider);

			// Ensure domain has proper values and no undefined fields
			const cleanDomain = {
				verifyingContract:
					domain.verifyingContract || ethers.ZeroAddress,
				chainId: domain.chainId || chainId,
			};

			// Ensure message has proper values
			// The message could be either a hash object or the actual Safe transaction data
			const cleanMessage = message.hash
				? {
						hash: message.hash || ethers.ZeroHash,
				  }
				: {
						// Actual Safe transaction data
						to: message.to || ethers.ZeroAddress,
						value: message.value || "0",
						data: message.data || "0x",
						operation: message.operation || 0,
						safeTxGas: message.safeTxGas || "0",
						baseGas: message.baseGas || "0",
						gasPrice: message.gasPrice || "0",
						gasToken: message.gasToken || ethers.ZeroAddress,
						refundReceiver:
							message.refundReceiver || ethers.ZeroAddress,
						nonce: message.nonce || 0,
				  };

			// Ensure all address fields in types are properly formatted
			const cleanTypes = JSON.parse(JSON.stringify(types));

			console.log("Signing with clean data", {
				cleanDomain,
				cleanMessage,
				cleanTypes,
			});

			// Ensure all addresses are properly checksummed
			const cleanDomainWithChecksum = {
				verifyingContract: ethers.getAddress(
					cleanDomain.verifyingContract
				),
				chainId: cleanDomain.chainId,
			};

			// Create a wallet without provider to avoid ENS resolution
			const walletNoProvider = new ethers.Wallet(privateKey);

			// Use the signTypedData method with properly formatted data
			const signature = await walletNoProvider.signTypedData(
				cleanDomainWithChecksum,
				cleanTypes,
				cleanMessage
			);

			console.log("Typed data signed successfully", { walletId });
			return signature;
		} catch (error) {
			console.error("Failed to sign typed data:", error);
			throw new Error("Signing failed");
		}
	}

	/**
	 * Sends transaction via agent wallet
	 */
	async sendTransaction(
		walletId: string,
		chainId: number,
		transaction: {
			to: string;
			value?: string;
			data?: string;
			gasLimit?: string;
		}
	): Promise<string> {
		try {
			console.log("Sending transaction via agent wallet", {
				walletId,
				chainId,
				transaction,
			});

			const privateKey = await this.getWalletPrivateKey(walletId);
			const { ethers } = await import("ethers");

			// Get the RPC URL for the specific chain
			const chainConfig = config.chains.find(
				(c) => c.chainId === chainId
			);
			if (!chainConfig) {
				throw new Error(`Chain ${chainId} not configured`);
			}

			const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
			const wallet = new ethers.Wallet(privateKey, provider);

			const txResponse = await wallet.sendTransaction({
				to: transaction.to,
				value: transaction.value ? BigInt(transaction.value) : 0n,
				data: transaction.data || "0x",
				gasLimit: transaction.gasLimit
					? BigInt(transaction.gasLimit)
					: undefined,
			});

			await txResponse.wait();

			console.log("Transaction sent successfully", {
				walletId,
				chainId,
				txHash: txResponse.hash,
			});

			return txResponse.hash;
		} catch (error) {
			console.error("Failed to send transaction:", error);
			throw new Error(`Transaction failed on chain ${chainId}`);
		}
	}

	/**
	 * Get wallet balance
	 */
	async getBalance(walletId: string, chainId: number): Promise<string> {
		try {
			const privateKey = await this.getWalletPrivateKey(walletId);
			const { ethers } = await import("ethers");

			// Get the RPC URL for the specific chain
			const chainConfig = config.chains.find(
				(c) => c.chainId === chainId
			);
			if (!chainConfig) {
				throw new Error(`Chain ${chainId} not configured`);
			}

			const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
			const wallet = new ethers.Wallet(privateKey, provider);

			const balance = await provider.getBalance(wallet.address);
			return balance.toString();
		} catch (error) {
			console.error("Failed to get wallet balance:", error);
			throw new Error(`Balance check failed on chain ${chainId}`);
		}
	}

	/**
	 * Get wallet address
	 */
	async getWalletAddress(walletId: string): Promise<string> {
		try {
			const cached = this.walletCache.get(walletId);
			if (cached) {
				return cached.address;
			}

			// If not in cache, derive from private key
			const privateKey = await this.getWalletPrivateKey(walletId);
			const { ethers } = await import("ethers");
			const wallet = new ethers.Wallet(privateKey);
			return wallet.address;
		} catch (error) {
			console.error("Failed to get wallet address:", error);
			throw new Error("Address retrieval failed");
		}
	}
}
