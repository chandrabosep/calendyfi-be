import * as dotenv from "dotenv";
import { AppConfig, ChainConfig } from "../types";

// Load environment variables
dotenv.config();

function validateEnvVar(name: string, value: string | undefined): string {
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

function getChainConfig(): ChainConfig[] {
	const chains: ChainConfig[] = [];

	// Sepolia Testnet (default)
	if (
		process.env.SEPOLIA_RPC_URL &&
		process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY
	) {
		chains.push({
			chainId: 11155111,
			name: "Sepolia Testnet",
			rpcUrl: process.env.SEPOLIA_RPC_URL,
			deployerPrivateKey: process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY,
			safeSupported: true, // Safe Protocol Kit supports Sepolia
		});
	}

	// Flow EVM Testnet (Custom Smart Account - Not Safe Compatible)
	if (
		process.env.FLOW_EVM_RPC_URL &&
		process.env.FLOW_EVM_DEPLOYER_PRIVATE_KEY
	) {
		chains.push({
			chainId: 545, // Correct Flow EVM testnet chain ID
			name: "Flow EVM Testnet",
			rpcUrl: process.env.FLOW_EVM_RPC_URL,
			deployerPrivateKey: process.env.FLOW_EVM_DEPLOYER_PRIVATE_KEY,
			safeSupported: false, // Custom smart account required
		});
	}

	// Flow Cadence Testnet (Flow Actions & Scheduled Transactions)
	if (process.env.FLOW_CADENCE_ACCESS_NODE) {
		chains.push({
			chainId: 646, // Flow Cadence testnet chain ID
			name: "Flow Cadence Testnet",
			rpcUrl: process.env.FLOW_CADENCE_ACCESS_NODE,
			deployerPrivateKey: process.env.FLOW_CADENCE_PRIVATE_KEY || "",
			safeSupported: false, // Uses Flow Actions instead
		});
	}

	// Rootstock Testnet
	if (
		process.env.ROOTSTOCK_RPC_URL &&
		process.env.ROOTSTOCK_DEPLOYER_PRIVATE_KEY
	) {
		chains.push({
			chainId: 31,
			name: "Rootstock Testnet",
			rpcUrl: process.env.ROOTSTOCK_RPC_URL,
			deployerPrivateKey: process.env.ROOTSTOCK_DEPLOYER_PRIVATE_KEY,
			safeSupported: true, // Safe Protocol Kit supports Rootstock
		});
	}

	// Fallback to legacy environment variables for backward compatibility
	if (
		chains.length === 0 &&
		process.env.RPC_URL &&
		process.env.DEPLOYER_PRIVATE_KEY
	) {
		chains.push({
			chainId: parseInt(process.env.CHAIN_ID || "11155111"),
			name: "Legacy Chain",
			rpcUrl: process.env.RPC_URL,
			deployerPrivateKey: process.env.DEPLOYER_PRIVATE_KEY,
			safeSupported: true, // Assume legacy is Safe-supported
		});
	}

	// Also add legacy config if it's for Sepolia but Sepolia-specific vars aren't set
	if (
		process.env.RPC_URL &&
		process.env.DEPLOYER_PRIVATE_KEY &&
		process.env.CHAIN_ID === "11155111" &&
		!chains.some((chain) => chain.chainId === 11155111)
	) {
		chains.push({
			chainId: 11155111,
			name: "Sepolia Testnet (Legacy)",
			rpcUrl: process.env.RPC_URL,
			deployerPrivateKey: process.env.DEPLOYER_PRIVATE_KEY,
			safeSupported: true, // Sepolia is Safe-supported
		});
	}

	if (chains.length === 0) {
		throw new Error(
			"No chain configuration found. Please set up at least one chain."
		);
	}

	return chains;
}

export const config: AppConfig = {
	port: parseInt(process.env.PORT || "3000", 10),
	nodeEnv: process.env.NODE_ENV || "development",
	googleClientId: validateEnvVar(
		"GOOGLE_CLIENT_ID",
		process.env.GOOGLE_CLIENT_ID
	),
	googleClientSecret: validateEnvVar(
		"GOOGLE_CLIENT_SECRET",
		process.env.GOOGLE_CLIENT_SECRET
	),
	googleRedirectUri: validateEnvVar(
		"GOOGLE_REDIRECT_URI",
		process.env.GOOGLE_REDIRECT_URI
	),
	databaseUrl: validateEnvVar("DATABASE_URL", process.env.DATABASE_URL),
	encryptionKey: validateEnvVar("ENCRYPTION_KEY", process.env.ENCRYPTION_KEY),
	webhookSecret: validateEnvVar("WEBHOOK_SECRET", process.env.WEBHOOK_SECRET),
	geminiApiKey: validateEnvVar("GEMINI_API_KEY", process.env.GEMINI_API_KEY),
	chains: getChainConfig(),
	defaultChainId: parseInt(process.env.DEFAULT_CHAIN_ID || "11155111"),
};

export default config;
