import * as dotenv from "dotenv";
import { AppConfig } from "../types";

// Load environment variables
dotenv.config();

function validateEnvVar(name: string, value: string | undefined): string {
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
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
};

export default config;
