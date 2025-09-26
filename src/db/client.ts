import { PrismaClient } from "@prisma/client";

declare global {
	// eslint-disable-next-line no-var
	var __prisma: PrismaClient | undefined;
}

// Connection pool configuration for better reliability
const prismaConfig = {
	log: ["error" as const], // Only log errors, not queries/info/warn
	datasources: {
		db: {
			url: process.env.DATABASE_URL,
		},
	},
	// Connection pool settings
	transactionOptions: {
		maxWait: 10000, // 10 seconds
		timeout: 30000, // 30 seconds
	},
};

// Prevent multiple instances of Prisma Client in development
export const prisma = globalThis.__prisma || new PrismaClient(prismaConfig);

if (process.env.NODE_ENV !== "production") {
	globalThis.__prisma = prisma;
}

// Add connection health check and retry logic
export async function checkDatabaseConnection(): Promise<boolean> {
	try {
		await prisma.$queryRaw`SELECT 1`;
		return true;
	} catch (error) {
		console.error("Database connection check failed:", error);
		return false;
	}
}

// Graceful shutdown
export async function disconnectDatabase(): Promise<void> {
	try {
		await prisma.$disconnect();
		console.log("Database connection closed gracefully");
	} catch (error) {
		console.error("Error closing database connection:", error);
	}
}

// Retry wrapper for database operations
export async function withRetry<T>(
	operation: () => Promise<T>,
	maxRetries: number = 3,
	delay: number = 1000
): Promise<T> {
	let lastError: Error;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await operation();
		} catch (error) {
			lastError = error as Error;

			// Check if it's a connection error
			if (error && typeof error === "object" && "code" in error) {
				const prismaError = error as any;
				if (
					prismaError.code === "P1017" ||
					prismaError.code === "P1001"
				) {
					console.warn(
						`Database connection error (attempt ${attempt}/${maxRetries}):`,
						prismaError.message
					);

					if (attempt < maxRetries) {
						// Wait before retrying
						await new Promise((resolve) =>
							setTimeout(resolve, delay * attempt)
						);
						continue;
					}
				}
			}

			// If it's not a connection error or we've exhausted retries, throw
			throw error;
		}
	}

	throw lastError!;
}

export default prisma;
