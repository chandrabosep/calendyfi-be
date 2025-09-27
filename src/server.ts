import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config";
import authRoutes from "./api/auth";
import calendarRoutes from "./api/calendar";
import walletRoutes from "./api/wallet";
import { ApiResponse } from "./types";
import { startScheduler, stopScheduler } from "../src/services/scheduler";
import { checkDatabaseConnection, disconnectDatabase } from "./db/client";
import { aiOnlyDetectEvents } from "./scripts/ai-only-detector";

const app = express();

// Security middleware
app.use(helmet());
app.use(
	cors({
		origin:
			process.env.NODE_ENV === "production"
				? ["https://yourdomain.com"]
				: ["http://localhost:3000", "http://localhost:3001"],
		credentials: true,
	})
);

// Rate limiting
const limiter = rateLimit({
	windowMs: 1 * 60 * 1000, // 15 minutes
	max: 100, // limit each IP to 100 requests per windowMs
	message: {
		success: false,
		error: "Too many requests from this IP, please try again later.",
	} as ApiResponse,
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Request logging middleware
app.use((req, res, next) => {
	console.info("Incoming request", {
		method: req.method,
		url: req.url,
		userAgent: req.get("User-Agent"),
		ip: req.ip,
	});
	next();
});

// Health check endpoint
app.get("/health", async (req, res) => {
	try {
		const dbHealthy = await checkDatabaseConnection();

		res.json({
			success: true,
			data: {
				status: dbHealthy ? "healthy" : "degraded",
				timestamp: new Date().toISOString(),
				version: "1.0.0",
				database: dbHealthy ? "connected" : "disconnected",
			},
		} as ApiResponse);
	} catch (error) {
		res.status(503).json({
			success: false,
			error: "Health check failed",
			data: {
				status: "unhealthy",
				timestamp: new Date().toISOString(),
				database: "error",
			},
		} as ApiResponse);
	}
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/wallet", walletRoutes);

// 404 handler
app.use((req, res) => {
	console.warn("Route not found", {
		method: req.method,
		url: req.url,
		ip: req.ip,
	});

	res.status(404).json({
		success: false,
		error: "Route not found",
	} as ApiResponse);
});

// Global error handler
app.use(
	(
		error: Error,
		req: express.Request,
		res: express.Response,
		next: express.NextFunction
	) => {
		console.error("Unhandled error", {
			error: error.message,
			stack: error.stack,
			method: req.method,
			url: req.url,
			ip: req.ip,
		});

		res.status(500).json({
			success: false,
			error:
				config.nodeEnv === "production"
					? "Internal server error"
					: error.message,
		} as ApiResponse);
	}
);

// Start server
const server = app.listen(config.port, () => {
	console.info("CalendarHook server started", {
		port: config.port,
		nodeEnv: config.nodeEnv,
		timestamp: new Date().toISOString(),
	});

	// Start AI monitoring
	console.info("🤖 AI monitoring started - checking every 30 seconds");

	// Run initial detection silently
	aiOnlyDetectEvents().catch((error) => {
		console.error("Initial AI detection failed:", { error });
	});

	// Set up interval for continuous detection
	const aiMonitorInterval = setInterval(async () => {
		try {
			await aiOnlyDetectEvents();
		} catch (error) {
			console.error("AI detection failed:", { error });
		}
	}, 30 * 1000); // Every 30 seconds

	// Start transaction scheduler
	console.info("⏰ Transaction scheduler started - checking every minute");
	startScheduler(1); // Check every minute

	// Clean up interval on shutdown
	process.on("SIGTERM", () => {
		clearInterval(aiMonitorInterval);
		stopScheduler();
	});

	process.on("SIGINT", () => {
		clearInterval(aiMonitorInterval);
		stopScheduler();
	});
});

// Graceful shutdown
process.on("SIGTERM", async () => {
	console.info("SIGTERM received, shutting down gracefully");
	stopScheduler();
	await disconnectDatabase();
	server.close(() => {
		console.info("Server closed");
		process.exit(0);
	});
});

process.on("SIGINT", async () => {
	console.info("SIGINT received, shutting down gracefully");
	stopScheduler();
	await disconnectDatabase();
	server.close(() => {
		console.info("Server closed");
		process.exit(0);
	});
});

export default app;
