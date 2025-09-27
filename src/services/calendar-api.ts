import { google } from "googleapis";
import { GoogleCalendarEvent, CalendarEventData } from "../types";
import { isAiEvent } from "../utils/logger";
import { createAiEventProcessor } from "./ai-event-processor";

export class CalendarApiService {
	public calendar: any;
	private aiEventProcessor: any;

	constructor(accessToken: string) {
		const auth = new google.auth.OAuth2();
		auth.setCredentials({ access_token: accessToken });
		this.calendar = google.calendar({ version: "v3", auth });
		this.aiEventProcessor = createAiEventProcessor();
	}

	async getRecentEvents(
		calendarId: string = "primary",
		hoursBack: number = 24
	): Promise<GoogleCalendarEvent[]> {
		try {
			const timeMin = new Date();
			timeMin.setHours(timeMin.getHours() - hoursBack);

			const response = await this.calendar.events.list({
				calendarId,
				timeMin: timeMin.toISOString(),
				maxResults: 100,
				singleEvents: true,
				orderBy: "startTime",
			});

			const events = response.data.items || [];

			console.info("Fetched recent events", {
				calendarId,
				hoursBack,
				eventCount: events.length,
			});

			return events;
		} catch (error) {
			console.error("Failed to fetch recent events", {
				error,
				calendarId,
			});
			throw new Error("Failed to fetch calendar events");
		}
	}

	async getAllEvents(
		calendarId: string = "primary",
		daysBack: number = 7,
		daysForward: number = 7
	): Promise<GoogleCalendarEvent[]> {
		try {
			const timeMin = new Date();
			timeMin.setDate(timeMin.getDate() - daysBack);

			const timeMax = new Date();
			timeMax.setDate(timeMax.getDate() + daysForward);

			const response = await this.calendar.events.list({
				calendarId,
				timeMin: timeMin.toISOString(),
				timeMax: timeMax.toISOString(),
				maxResults: 100,
				singleEvents: true,
				orderBy: "startTime",
			});

			const events = response.data.items || [];

			// Silent fetch - no logging unless error

			return events;
		} catch (error) {
			console.error("Failed to fetch all events", {
				error,
				calendarId,
			});
			throw new Error("Failed to fetch calendar events");
		}
	}

	async subscribeToCalendarChanges(
		calendarId: string,
		webhookUrl: string,
		expirationTime: number
	): Promise<{ channelId: string; resourceId: string }> {
		try {
			const response = await this.calendar.events.watch({
				calendarId,
				requestBody: {
					id: `calendarhook-${Date.now()}`,
					type: "web_hook",
					address: webhookUrl,
					expiration: expirationTime,
				},
			});

			console.info("Subscribed to calendar changes", {
				calendarId,
				channelId: response.data.id,
				resourceId: response.data.resourceId,
				expiration: response.data.expiration,
			});

			return {
				channelId: response.data.id!,
				resourceId: response.data.resourceId!,
			};
		} catch (error) {
			console.error("Failed to subscribe to calendar changes", {
				error,
				calendarId,
			});
			throw new Error("Failed to subscribe to calendar notifications");
		}
	}

	async stopCalendarSubscription(
		channelId: string,
		resourceId: string
	): Promise<void> {
		try {
			await this.calendar.channels.stop({
				requestBody: {
					id: channelId,
					resourceId: resourceId,
				},
			});

			console.info("Stopped calendar subscription", {
				channelId,
				resourceId,
			});
		} catch (error) {
			console.error("Failed to stop calendar subscription", {
				error,
				channelId,
				resourceId,
			});
			throw new Error("Failed to stop calendar subscription");
		}
	}

	transformGoogleEventToCalendarEventData(
		googleEvent: GoogleCalendarEvent,
		userId: string,
		calendarId: string
	): CalendarEventData {
		// Handle start time - prioritize dateTime over date, handle undefined cases
		let startTime: Date;
		if (googleEvent.start.dateTime) {
			startTime = new Date(googleEvent.start.dateTime);
		} else if (googleEvent.start.date) {
			startTime = new Date(googleEvent.start.date);
		} else {
			// If no start time is provided, use current time as fallback
			startTime = new Date();
			console.warn(
				"No start time found in Google Calendar event, using current time",
				{
					eventId: googleEvent.id,
					title: googleEvent.summary,
				}
			);
		}

		// Handle end time - prioritize dateTime over date, handle undefined cases
		let endTime: Date;
		if (googleEvent.end.dateTime) {
			endTime = new Date(googleEvent.end.dateTime);
		} else if (googleEvent.end.date) {
			endTime = new Date(googleEvent.end.date);
		} else {
			// If no end time is provided, use start time + 1 hour as fallback
			endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
			console.warn(
				"No end time found in Google Calendar event, using start time + 1 hour",
				{
					eventId: googleEvent.id,
					title: googleEvent.summary,
				}
			);
		}

		return {
			googleEventId: googleEvent.id,
			calendarId,
			title: googleEvent.summary || "Untitled Event",
			description: googleEvent.description,
			startTime,
			endTime,
			location: googleEvent.location,
			attendees: googleEvent.attendees,
			isAiEvent: isAiEvent(googleEvent.description, googleEvent.summary),
		};
	}

	/**
	 * Process AI events by parsing commands and determining actions
	 */
	async processAiEvent(
		eventText: string,
		userId: string,
		eventId?: string,
		scheduledTime?: Date
	): Promise<{
		success: boolean;
		parsedCommand?: any;
		nextSteps?: string[];
		error?: string;
	}> {
		try {
			console.info("Processing AI event in CalendarApiService", {
				userId,
				eventId,
				eventText: eventText.substring(0, 100),
				scheduledTime: scheduledTime?.toISOString(),
				scheduledTimeProvided: !!scheduledTime,
			});

			const result = await this.aiEventProcessor.processAiEvent(
				eventText,
				userId,
				eventId,
				scheduledTime
			);

			if (result.success && result.parsedCommand) {
				// Log the parsed command details
				console.info("AI command parsed successfully", {
					userId,
					eventId,
					intent: result.parsedCommand.intent.type,
					action: result.parsedCommand.action.type,
					confidence: result.parsedCommand.confidence,
					scheduledTime:
						result.parsedCommand.scheduledTime?.toISOString(),
					nextStepsCount: result.nextSteps?.length || 0,
				});
			}

			return result;
		} catch (error) {
			console.error("Failed to process AI event in CalendarApiService", {
				error,
				userId,
				eventId,
			});

			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}
}

export function createCalendarApiService(
	accessToken: string
): CalendarApiService {
	return new CalendarApiService(accessToken);
}
