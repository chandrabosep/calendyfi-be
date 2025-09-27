import { ethers } from "ethers";

export interface TokenInfo {
	symbol: string;
	name: string;
	decimals: number;
	contractAddress: string;
	chainId: number;
}

export interface TokenTransfer {
	token: TokenInfo;
	to: string;
	amount: string; // in wei or token units
	value?: string; // for native token transfers
}

export class TokenService {
	private readonly tokenRegistry: Map<string, TokenInfo> = new Map();
	private readonly tokenAliases: Map<string, string> = new Map();

	constructor() {
		this.initializeTokenRegistry();
		this.initializeTokenAliases();
	}

	private initializeTokenRegistry() {
		// Rootstock Testnet tokens
		this.tokenRegistry.set("rbtc-31", {
			symbol: "RBTC",
			name: "Rootstock Bitcoin",
			decimals: 18,
			contractAddress: "0x0000000000000000000000000000000000000000", // Native token
			chainId: 31,
		});

		// Rootstock Mainnet tokens
		this.tokenRegistry.set("rbtc-30", {
			symbol: "RBTC",
			name: "Rootstock Bitcoin",
			decimals: 18,
			contractAddress: "0x0000000000000000000000000000000000000000", // Native token
			chainId: 30,
		});

		// RIF token on Rootstock Testnet
		this.tokenRegistry.set("rif-31", {
			symbol: "RIF",
			name: "RIF Token",
			decimals: 18,
			contractAddress: "0x19f64674d8a5b4e652319f5e239efd3bc969a1fe", // RIF testnet address
			chainId: 31,
		});

		// RIF token on Rootstock Mainnet
		this.tokenRegistry.set("rif-30", {
			symbol: "RIF",
			name: "RIF Token",
			decimals: 18,
			contractAddress: "0x2acc95758f8b5f583470ba265eb685a8f45fc9d5", // RIF mainnet address
			chainId: 30,
		});

		// Sepolia tokens
		this.tokenRegistry.set("eth-11155111", {
			symbol: "ETH",
			name: "Ethereum",
			decimals: 18,
			contractAddress: "0x0000000000000000000000000000000000000000", // Native token
			chainId: 11155111,
		});

		// Flow EVM tokens
		this.tokenRegistry.set("flow-545", {
			symbol: "FLOW",
			name: "Flow",
			decimals: 18,
			contractAddress: "0x0000000000000000000000000000000000000000", // Native token
			chainId: 545,
		});
	}

	private initializeTokenAliases() {
		// Token aliases for common variations
		this.tokenAliases.set("trbtc", "rbtc"); // Test Rootstock Bitcoin -> Rootstock Bitcoin
		this.tokenAliases.set("testrbtc", "rbtc"); // Test Rootstock Bitcoin -> Rootstock Bitcoin
		this.tokenAliases.set("testbtc", "rbtc"); // Test Bitcoin -> Rootstock Bitcoin
		this.tokenAliases.set("tbtc", "rbtc"); // Test Bitcoin -> Rootstock Bitcoin
	}

	/**
	 * Get token information by symbol and chain
	 */
	getTokenInfo(symbol: string, chainId: number): TokenInfo | null {
		const normalizedSymbol = symbol.toLowerCase();

		// Check for aliases first
		const aliasedSymbol =
			this.tokenAliases.get(normalizedSymbol) || normalizedSymbol;

		const key = `${aliasedSymbol}-${chainId}`;
		return this.tokenRegistry.get(key) || null;
	}

	/**
	 * Parse token amount from user input
	 */
	parseTokenAmount(amount: string, token: TokenInfo): string {
		try {
			// Convert to wei/token units
			const parsedAmount = ethers.parseUnits(amount, token.decimals);
			return parsedAmount.toString();
		} catch (error) {
			throw new Error(`Invalid token amount: ${amount}`);
		}
	}

	/**
	 * Format token amount for display
	 */
	formatTokenAmount(amount: string, token: TokenInfo): string {
		try {
			const formatted = ethers.formatUnits(amount, token.decimals);
			return formatted;
		} catch (error) {
			return amount;
		}
	}

	/**
	 * Check if a token is native (ETH, RBTC, FLOW)
	 */
	isNativeToken(token: TokenInfo): boolean {
		return (
			token.contractAddress ===
			"0x0000000000000000000000000000000000000000"
		);
	}

	/**
	 * Create ERC20 transfer transaction data
	 */
	createERC20TransferData(to: string, amount: string): string {
		const iface = new ethers.Interface([
			"function transfer(address to, uint256 amount) returns (bool)",
		]);

		return iface.encodeFunctionData("transfer", [to, amount]);
	}

	/**
	 * Build transaction for token transfer
	 */
	buildTokenTransferTransaction(tokenTransfer: TokenTransfer): {
		to: string;
		value: string;
		data: string;
	} {
		const { token, to, amount } = tokenTransfer;

		if (this.isNativeToken(token)) {
			// Native token transfer (ETH, RBTC, FLOW)
			return {
				to,
				value: amount,
				data: "0x",
			};
		} else {
			// ERC20 token transfer
			const transferData = this.createERC20TransferData(to, amount);
			return {
				to: token.contractAddress,
				value: "0",
				data: transferData,
			};
		}
	}

	/**
	 * Get all supported tokens for a chain
	 */
	getSupportedTokens(chainId: number): TokenInfo[] {
		const tokens: TokenInfo[] = [];

		for (const [key, token] of this.tokenRegistry) {
			if (token.chainId === chainId) {
				tokens.push(token);
			}
		}

		return tokens;
	}

	/**
	 * Validate token symbol
	 */
	validateTokenSymbol(symbol: string, chainId: number): boolean {
		return this.getTokenInfo(symbol, chainId) !== null;
	}
}
