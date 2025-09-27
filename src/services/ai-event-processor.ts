import { GeminiService, ParsedEventData } from "./gemini-service";
import { CalendarApiService } from "./calendar-api";
import prisma from "../db/client";

export interface ProcessedEvent {
	parsed: ParsedEventData;
	conflicts?: Array<{ title: string; startTime: Date; endTime: Date }>;
	conflictAnalysis?: {
		severity: "low" | "medium" | "high";
		suggestions: string[];
	};
	dbEvent?: any;
	googleEventId?: string;
}

export class AIEventProcessor {
	private geminiService: GeminiService;
	private calendarService: CalendarApiService;

	constructor() {
		this.geminiService = new GeminiService();
		this.calendarService = new CalendarApiService();
	}

	/**
	 * Process natural language input and create event
	 */
	async processAndCreateEvent(
		userId: string,
		input: string,
		accessToken: string,
		refreshToken?: string,
		autoCreate: boolean = false
	): Promise<ProcessedEvent> {
		try {
			// Parse the natural language input
			const parsed = await this.geminiService.parseEventFromText(input);

			// Check for conflicts
			const conflicts = await this.calendarService.checkConflicts(
				accessToken,
				new Date(parsed.startTime),
				new Date(parsed.endTime),
				refreshToken
			);

			let conflictAnalysis;
			if (conflicts.length > 0) {
				conflictAnalysis = await this.geminiService.analyzeConflicts(
					{
						title: parsed.title,
						startTime: new Date(parsed.startTime),
						endTime: new Date(parsed.endTime),
					},
					conflicts
				);
			}

			const result: ProcessedEvent = {
				parsed,
				conflicts: conflicts.length > 0 ? conflicts : undefined,
				conflictAnalysis,
			};

			// Auto-create if requested and no high-severity conflicts
			if (
				autoCreate &&
				(!conflictAnalysis || conflictAnalysis.severity !== "high")
			) {
				try {
					// Create in Google Calendar
					const googleEventId =
						await this.calendarService.createEvent(
							accessToken,
							{
								title: parsed.title,
								description: parsed.description,
								startTime: new Date(parsed.startTime),
								endTime: new Date(parsed.endTime),
								location: parsed.location,
								attendees: parsed.attendees,
							},
							refreshToken
						);

					// Save to database
					const dbEvent = await prisma.event.create({
						data: {
							googleId: googleEventId,
							title: parsed.title,
							description: parsed.description,
							startTime: new Date(parsed.startTime),
							endTime: new Date(parsed.endTime),
							location: parsed.location,
							rawInput: input,
							aiProcessed: true,
							confidence: parsed.confidence,
							suggestedChanges: parsed.suggestions
								? { suggestions: parsed.suggestions }
								: null,
							userId,
						},
					});

					result.dbEvent = dbEvent;
					result.googleEventId = googleEventId;
				} catch (createError) {
					console.error("Failed to auto-create event:", createError);
					// Don't throw here, return the parsed data anyway
				}
			}

			return result;
		} catch (error) {
			console.error("Failed to process event:", error);
			throw new Error("Failed to process natural language event");
		}
	}

	/**
	 * Generate smart suggestions for user
	 */
	async generateSmartSuggestions(
		userId: string,
		context?: string
	): Promise<string[]> {
		try {
			// Get user's recent events
			const recentEvents = await prisma.event.findMany({
				where: { userId },
				orderBy: { startTime: "desc" },
				take: 10,
				select: {
					title: true,
					startTime: true,
					endTime: true,
				},
			});

			if (recentEvents.length === 0) {
				return [
					"Daily standup meeting tomorrow at 9 AM",
					"Lunch with team on Friday",
					"Review meeting next week",
					"Project deadline reminder",
				];
			}

			return await this.geminiService.generateEventSuggestions(
				recentEvents,
				context
			);
		} catch (error) {
			console.error("Failed to generate suggestions:", error);
			return [];
		}
	}

	/**
	 * Optimize event timing based on user patterns
	 */
	async optimizeEventTiming(
		userId: string,
		eventText: string
	): Promise<{
		originalParsing: ParsedEventData;
		optimizedSuggestions: Array<{
			startTime: string;
			endTime: string;
			reason: string;
		}>;
	}> {
		try {
			// Get user preferences (could be from database in future)
			const userPreferences = {
				workingHours: { start: "09:00", end: "17:00" },
				timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				preferredMeetingDuration: 60, // minutes
			};

			return await this.geminiService.optimizeEventTiming(
				eventText,
				userPreferences
			);
		} catch (error) {
			console.error("Failed to optimize timing:", error);
			const originalParsing = await this.geminiService.parseEventFromText(
				eventText
			);
			return { originalParsing, optimizedSuggestions: [] };
		}
	}

	/**
	 * Batch process multiple events
	 */
	async batchProcessEvents(
		userId: string,
		inputs: string[],
		accessToken: string,
		refreshToken?: string
	): Promise<ProcessedEvent[]> {
		const results: ProcessedEvent[] = [];

		for (const input of inputs) {
			try {
				const result = await this.processAndCreateEvent(
					userId,
					input,
					accessToken,
					refreshToken,
					false // Don't auto-create for batch processing
				);
				results.push(result);
			} catch (error) {
				console.error(`Failed to process: "${input}"`, error);
				// Continue with other events
			}
		}

		return results;
	}

	/**
	 * Get AI processing statistics for user
	 */
	async getProcessingStats(userId: string): Promise<{
		totalProcessed: number;
		averageConfidence: number;
		recentActivity: Array<{
			date: Date;
			input: string;
			success: boolean;
			confidence: number;
		}>;
	}> {
		try {
			const events = await prisma.event.findMany({
				where: {
					userId,
					aiProcessed: true,
				},
				select: {
					rawInput: true,
					confidence: true,
					createdAt: true,
				},
				orderBy: { createdAt: "desc" },
				take: 50,
			});

			const totalProcessed = events.length;
			const averageConfidence =
				events.reduce((sum, e) => sum + (e.confidence || 0), 0) /
				Math.max(1, totalProcessed);

			const recentActivity = events.slice(0, 10).map((event) => ({
				date: event.createdAt,
				input: event.rawInput || "",
				success: true,
				confidence: event.confidence || 0,
			}));

			return {
				totalProcessed,
				averageConfidence,
				recentActivity,
			};
		} catch (error) {
			console.error("Failed to get processing stats:", error);
			return {
				totalProcessed: 0,
				averageConfidence: 0,
				recentActivity: [],
			};
		}
	}
}
