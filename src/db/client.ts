import { PrismaClient } from "@prisma/client";

// Global for production & development
declare global {
	var __db: PrismaClient | undefined;
}

let prisma: PrismaClient;

// Ensure single instance in development
if (process.env.NODE_ENV === "production") {
	prisma = new PrismaClient();
} else {
	if (!global.__db) {
		global.__db = new PrismaClient();
	}
	prisma = global.__db;
}

// Graceful shutdown
process.on("beforeExit", async () => {
	await prisma.$disconnect();
});

export { prisma };
export default prisma;
