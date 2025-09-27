import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./api/auth";
import calendarRoutes from "./api/calendar";
import walletRoutes from "./api/wallet";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/wallet", walletRoutes);

// Basic health check
app.get("/health", (req, res) => {
	res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
	console.log(`🚀 Server running on port ${PORT}`);
	console.log(`📡 Health check: http://localhost:${PORT}/health`);
});

export default app;
