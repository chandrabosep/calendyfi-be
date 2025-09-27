import { ethers } from "ethers";

export interface NameResolutionResult {
	address: string;
	service: "RNS" | "ENS" | "NONE";
	name: string;
	chainId: number;
}

export class NameResolutionService {
	private readonly providers: Map<number, ethers.Provider> = new Map();

	// RNS and ENS resolver contract addresses
	private readonly resolverContracts: {
		rns: Record<number, string>;
		ens: Record<number, string>;
	} = {
		// RNS on Rootstock Testnet and Mainnet
		rns: {
			31: "0x25c289cccfff700c6a38722f4913924fe504de0e", // RNS resolver on Rootstock Testnet
			30: "0xd87f8121d44f3717d4badc50b24e50044f86d64b", // RNS resolver on Rootstock Mainnet
		},
		// ENS on Ethereum/Sepolia
		ens: {
			1: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e", // ENS registry on mainnet
			11155111: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e", // ENS registry on Sepolia
		},
	};

	constructor() {
		this.initializeProviders();
	}

	private initializeProviders() {
		// Initialize providers for each chain
		if (process.env.ROOTSTOCK_RPC_URL) {
			this.providers.set(
				31,
				new ethers.JsonRpcProvider(process.env.ROOTSTOCK_RPC_URL)
			);
		}
		if (process.env.ROOTSTOCK_MAINNET_RPC_URL) {
			this.providers.set(
				30,
				new ethers.JsonRpcProvider(
					process.env.ROOTSTOCK_MAINNET_RPC_URL
				)
			);
		}
		if (process.env.SEPOLIA_RPC_URL) {
			this.providers.set(
				11155111,
				new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL)
			);
		}
		if (process.env.FLOW_EVM_RPC_URL) {
			this.providers.set(
				545,
				new ethers.JsonRpcProvider(process.env.FLOW_EVM_RPC_URL)
			);
		}
	}

	/**
	 * Resolve a name to an address
	 */
	async resolveName(
		name: string,
		chainId: number
	): Promise<NameResolutionResult> {
		// Clean the name
		const cleanName = name.toLowerCase().trim();

		// Check if it's already an address
		if (ethers.isAddress(cleanName)) {
			return {
				address: cleanName,
				service: "NONE",
				name: cleanName,
				chainId,
			};
		}

		// Try RNS resolution first (for Rootstock)
		// Always use Rootstock mainnet (chain 30) for RNS resolution, regardless of transaction chain
		if ((chainId === 31 || chainId === 30) && this.isRNSName(cleanName)) {
			const rnsResult = await this.resolveRNS(cleanName, 30); // Always use mainnet for RNS
			if (rnsResult) {
				// Return the result but keep the original chainId for transaction execution
				return {
					...rnsResult,
					chainId: chainId, // Keep original chainId for transaction execution
				};
			}
		}

		// Try ENS resolution (for Ethereum/Sepolia)
		if (
			(chainId === 1 || chainId === 11155111) &&
			this.isENSName(cleanName)
		) {
			const ensResult = await this.resolveENS(cleanName, chainId);
			if (ensResult) {
				return ensResult;
			}
		}

		// No fallback addresses - if RNS/ENS resolution fails, return the original input

		// If no resolution found, return the original input
		// Note: Real RNS/ENS resolution will return null if domain doesn't exist
		return {
			address: cleanName,
			service: "NONE",
			name: cleanName,
			chainId,
		};
	}

	/**
	 * Check if a name is a valid RNS name
	 */
	private isRNSName(name: string): boolean {
		// RNS names typically end with .rsk
		return name.endsWith(".rsk") || name.includes(".rsk");
	}

	/**
	 * Check if a name is a valid ENS name
	 */
	private isENSName(name: string): boolean {
		// ENS names typically end with .eth
		return name.endsWith(".eth") || name.includes(".eth");
	}

	/**
	 * Resolve RNS name
	 */
	private async resolveRNS(
		name: string,
		chainId: number
	): Promise<NameResolutionResult | null> {
		try {
			const provider = this.providers.get(chainId);
			if (!provider) {
				console.warn(`No provider available for chain ${chainId}`);
				return null;
			}

			// RNS Resolver ABI
			const resolverABI = [
				"function addr(bytes32 node) view returns (address)",
			];

			const resolverAddress = this.resolverContracts.rns[chainId];
			if (!resolverAddress) {
				console.warn(`No RNS resolver for chain ${chainId}`);
				return null;
			}

			// Ensure proper checksumming of resolver address
			const checksummedResolverAddress =
				ethers.getAddress(resolverAddress);

			// Try to create contract with proper checksumming
			let resolver;
			try {
				resolver = new ethers.Contract(
					checksummedResolverAddress,
					resolverABI,
					provider
				);
			} catch (checksumError) {
				console.warn(
					`RNS resolver address checksum error for ${chainId}:`,
					checksumError instanceof Error
						? checksumError.message
						: "Unknown error"
				);
				// For now, skip RNS resolution if there's a checksum issue
				return null;
			}

			// Convert name to node hash
			const nameHash = ethers.namehash(name);

			// Resolve address directly from resolver
			const address = await (resolver as any).addr(nameHash);

			if (
				address &&
				address !== "0x0000000000000000000000000000000000000000"
			) {
				return {
					address,
					service: "RNS",
					name,
					chainId,
				};
			}

			return null;
		} catch (error) {
			console.warn(`RNS resolution failed for ${name}:`, error);
			return null;
		}
	}

	/**
	 * Resolve ENS name
	 */
	private async resolveENS(
		name: string,
		chainId: number
	): Promise<NameResolutionResult | null> {
		try {
			const provider = this.providers.get(chainId);
			if (!provider) {
				console.warn(`No provider available for chain ${chainId}`);
				return null;
			}

			// ENS resolver ABI
			const resolverABI = [
				"function addr(bytes32 node) view returns (address)",
				"function name(bytes32 node) view returns (string)",
			];

			const resolverAddress = this.resolverContracts.ens[chainId];
			if (!resolverAddress) {
				console.warn(`No ENS resolver for chain ${chainId}`);
				return null;
			}

			// Ensure proper checksumming of resolver address
			const checksummedResolverAddress =
				ethers.getAddress(resolverAddress);

			const resolver = new ethers.Contract(
				checksummedResolverAddress,
				resolverABI,
				provider
			);

			// Convert name to node hash
			const nameHash = ethers.namehash(name);

			// Resolve address
			const address = await (resolver as any).addr(nameHash);

			if (
				address &&
				address !== "0x0000000000000000000000000000000000000000"
			) {
				return {
					address,
					service: "ENS",
					name,
					chainId,
				};
			}

			return null;
		} catch (error) {
			console.warn(`ENS resolution failed for ${name}:`, error);
			return null;
		}
	}

	/**
	 * Batch resolve multiple names
	 */
	async batchResolveNames(
		names: string[],
		chainId: number
	): Promise<NameResolutionResult[]> {
		const results: NameResolutionResult[] = [];

		for (const name of names) {
			try {
				const result = await this.resolveName(name, chainId);
				results.push(result);
			} catch (error) {
				console.warn(`Failed to resolve ${name}:`, error);
				results.push({
					address: name,
					service: "NONE",
					name,
					chainId,
				});
			}
		}

		return results;
	}

	/**
	 * Get supported name services for a chain
	 */
	getSupportedServices(chainId: number): string[] {
		const services: string[] = [];

		if (this.resolverContracts.rns[chainId]) {
			services.push("RNS");
		}

		if (this.resolverContracts.ens[chainId]) {
			services.push("ENS");
		}

		return services;
	}

	/**
	 * Validate name format
	 */
	validateNameFormat(name: string): boolean {
		// Basic validation for domain names
		const domainRegex =
			/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
		return domainRegex.test(name) || ethers.isAddress(name);
	}
}
