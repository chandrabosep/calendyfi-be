import express from "express";
import { CalendarApiService, CalendarEvent } from "../services/calendar-api";
import { TokenService } from "../utils/token-service";
import prisma from "../db/client";

const router = express.Router();
const calendarService = new CalendarApiService();

/**
 * Middleware to authenticate requests
 */
async function authenticateUser(req: any, res: any, next: any) {
	try {
		const authHeader = req.headers.authorization;
		if (!authHeader?.startsWith("Bearer ")) {
			return res.status(401).json({ error: "No token provided" });
		}

		const token = authHeader.substring(7);
		const payload = TokenService.verifyToken(token);

		const user = await prisma.user.findUnique({
			where: { id: payload.userId },
			select: {
				id: true,
				email: true,
				accessToken: true,
				refreshToken: true,
				accessTokenExpiry: true,
			},
		});

		if (!user || !user.accessToken) {
			return res
				.status(401)
				.json({ error: "Invalid user or missing calendar access" });
		}

		req.user = user;
		next();
	} catch (error) {
		res.status(401).json({ error: "Authentication failed" });
	}
}

/**
 * Get upcoming events
 */
router.get("/events", authenticateUser, async (req: any, res) => {
	try {
		const { maxResults = 10 } = req.query;

		const events = await calendarService.listEvents(
			req.user.accessToken,
			req.user.refreshToken,
			parseInt(maxResults)
		);

		res.json({ events });
	} catch (error) {
		console.error("Failed to fetch events:", error);
		res.status(500).json({
			error: "Failed to fetch events",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});
