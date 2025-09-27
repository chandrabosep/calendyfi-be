import express from "express";
import { CalendarApiService, CalendarEvent } from "../services/calendar-api";
import { AIEventProcessor } from "../services/ai-event-processor";
import { TokenService } from "../utils/token-service";
import prisma from "../db/client";

const router = express.Router();
const calendarService = new CalendarApiService();
const aiProcessor = new AIEventProcessor();

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

/**
 * Create a new event
 */
router.post("/events", authenticateUser, async (req: any, res) => {
	try {
		const { title, description, startTime, endTime, location, attendees } =
			req.body;

		// Validate required fields
		if (!title || !startTime || !endTime) {
			return res.status(400).json({
				error: "Title, startTime, and endTime are required",
			});
		}

		const event: CalendarEvent = {
			title,
			description,
			startTime: new Date(startTime),
			endTime: new Date(endTime),
			location,
			attendees,
		};

		// Check for conflicts
		const conflicts = await calendarService.checkConflicts(
			req.user.accessToken,
			event.startTime,
			event.endTime,
			req.user.refreshToken
		);

		// Create event in Google Calendar
		const googleEventId = await calendarService.createEvent(
			req.user.accessToken,
			event,
			req.user.refreshToken
		);

		// Store in database
		const dbEvent = await prisma.event.create({
			data: {
				googleId: googleEventId,
				title: event.title,
				description: event.description,
				startTime: event.startTime,
				endTime: event.endTime,
				location: event.location,
				userId: req.user.id,
			},
		});

		res.json({
			success: true,
			event: dbEvent,
			conflicts: conflicts.length > 0 ? conflicts : undefined,
		});
	} catch (error) {
		console.error("Failed to create event:", error);
		res.status(500).json({
			error: "Failed to create event",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

/**
 * Update an existing event
 */
router.put("/events/:eventId", authenticateUser, async (req: any, res) => {
	try {
		const { eventId } = req.params;
		const updates = req.body;

		// Find event in database
		const dbEvent = await prisma.event.findFirst({
			where: {
				id: eventId,
				userId: req.user.id,
			},
		});

		if (!dbEvent || !dbEvent.googleId) {
			return res.status(404).json({ error: "Event not found" });
		}

		// Prepare update data
		const updateData: Partial<CalendarEvent> = {};
		if (updates.title) updateData.title = updates.title;
		if (updates.description) updateData.description = updates.description;
		if (updates.startTime)
			updateData.startTime = new Date(updates.startTime);
		if (updates.endTime) updateData.endTime = new Date(updates.endTime);
		if (updates.location) updateData.location = updates.location;
		if (updates.attendees) updateData.attendees = updates.attendees;

		// Update in Google Calendar
		await calendarService.updateEvent(
			req.user.accessToken,
			dbEvent.googleId,
			updateData,
			req.user.refreshToken
		);

		// Update in database
		const updatedEvent = await prisma.event.update({
			where: { id: eventId },
			data: {
				title: updateData.title || dbEvent.title,
				description: updateData.description || dbEvent.description,
				startTime: updateData.startTime || dbEvent.startTime,
				endTime: updateData.endTime || dbEvent.endTime,
				location: updateData.location || dbEvent.location,
			},
		});

		res.json({
			success: true,
			event: updatedEvent,
		});
	} catch (error) {
		console.error("Failed to update event:", error);
		res.status(500).json({
			error: "Failed to update event",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

/**
 * Delete an event
 */
router.delete("/events/:eventId", authenticateUser, async (req: any, res) => {
	try {
		const { eventId } = req.params;

		// Find event in database
		const dbEvent = await prisma.event.findFirst({
			where: {
				id: eventId,
				userId: req.user.id,
			},
		});

		if (!dbEvent) {
			return res.status(404).json({ error: "Event not found" });
		}

		// Delete from Google Calendar if it exists
		if (dbEvent.googleId) {
			try {
				await calendarService.deleteEvent(
					req.user.accessToken,
					dbEvent.googleId,
					req.user.refreshToken
				);
			} catch (error) {
				console.warn("Failed to delete from Google Calendar:", error);
				// Continue with database deletion even if Google Calendar fails
			}
		}

		// Delete from database
		await prisma.event.delete({
			where: { id: eventId },
		});

		res.json({
			success: true,
			message: "Event deleted successfully",
		});
	} catch (error) {
		console.error("Failed to delete event:", error);
		res.status(500).json({
			error: "Failed to delete event",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

/**
 * Check for conflicts
 */
router.post(
	"/events/check-conflicts",
	authenticateUser,
	async (req: any, res) => {
		try {
			const { startTime, endTime } = req.body;

			if (!startTime || !endTime) {
				return res.status(400).json({
					error: "startTime and endTime are required",
				});
			}

			const conflicts = await calendarService.checkConflicts(
				req.user.accessToken,
				new Date(startTime),
				new Date(endTime),
				req.user.refreshToken
			);

			res.json({ conflicts });
		} catch (error) {
			console.error("Failed to check conflicts:", error);
			res.status(500).json({
				error: "Failed to check conflicts",
				details:
					error instanceof Error ? error.message : "Unknown error",
			});
		}
	}
);

/**
 * AI-powered event creation from natural language
 */
router.post("/ai/create-event", authenticateUser, async (req: any, res) => {
	try {
		const { input, autoCreate = false } = req.body;

		if (!input || typeof input !== "string") {
			return res
				.status(400)
				.json({ error: "Natural language input required" });
		}

		const result = await aiProcessor.processAndCreateEvent(
			req.user.id,
			input,
			req.user.accessToken,
			req.user.refreshToken,
			autoCreate
		);

		res.json({
			success: true,
			...result,
		});
	} catch (error) {
		console.error("AI event creation failed:", error);
		res.status(500).json({
			error: "Failed to process natural language event",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

/**
 * Get AI suggestions for events
 */
router.get("/ai/suggestions", authenticateUser, async (req: any, res) => {
	try {
		const { context } = req.query;

		const suggestions = await aiProcessor.generateSmartSuggestions(
			req.user.id,
			context as string
		);

		res.json({ suggestions });
	} catch (error) {
		console.error("Failed to generate suggestions:", error);
		res.status(500).json({
			error: "Failed to generate suggestions",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

/**
 * Optimize event timing
 */
router.post("/ai/optimize-timing", authenticateUser, async (req: any, res) => {
	try {
		const { eventText } = req.body;

		if (!eventText) {
			return res.status(400).json({ error: "Event text required" });
		}

		const optimization = await aiProcessor.optimizeEventTiming(
			req.user.id,
			eventText
		);

		res.json(optimization);
	} catch (error) {
		console.error("Failed to optimize timing:", error);
		res.status(500).json({
			error: "Failed to optimize event timing",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

/**
 * Batch process multiple events
 */
router.post("/ai/batch-process", authenticateUser, async (req: any, res) => {
	try {
		const { inputs } = req.body;

		if (!Array.isArray(inputs) || inputs.length === 0) {
			return res
				.status(400)
				.json({ error: "Array of event inputs required" });
		}

		if (inputs.length > 10) {
			return res
				.status(400)
				.json({ error: "Maximum 10 events per batch" });
		}

		const results = await aiProcessor.batchProcessEvents(
			req.user.id,
			inputs,
			req.user.accessToken,
			req.user.refreshToken
		);

		res.json({
			success: true,
			results,
			processed: results.length,
			total: inputs.length,
		});
	} catch (error) {
		console.error("Batch processing failed:", error);
		res.status(500).json({
			error: "Failed to batch process events",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

/**
 * Get AI processing statistics
 */
router.get("/ai/stats", authenticateUser, async (req: any, res) => {
	try {
		const stats = await aiProcessor.getProcessingStats(req.user.id);
		res.json(stats);
	} catch (error) {
		console.error("Failed to get AI stats:", error);
		res.status(500).json({
			error: "Failed to get processing statistics",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

export default router;
