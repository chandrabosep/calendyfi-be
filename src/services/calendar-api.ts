import { google } from "googleapis";
import { GoogleOAuthService } from "./google-oauth";

export interface CalendarEvent {
	id?: string;
	title: string;
	description?: string;
	startTime: Date;
	endTime: Date;
	location?: string;
	attendees?: string[];
}

export class CalendarApiService {
	private googleOAuth: GoogleOAuthService;

	constructor() {
		this.googleOAuth = new GoogleOAuthService();
	}

	/**
	 * Create authenticated calendar client
	 */
	private async getCalendarClient(
		accessToken: string,
		refreshToken?: string
	) {
		const oauth2Client = new google.auth.OAuth2(
			process.env.GOOGLE_CLIENT_ID,
			process.env.GOOGLE_CLIENT_SECRET,
			process.env.GOOGLE_REDIRECT_URI
		);

		oauth2Client.setCredentials({
			access_token: accessToken,
			refresh_token: refreshToken,
		});

		return google.calendar({ version: "v3", auth: oauth2Client });
	}

	/**
	 * List upcoming events
	 */
	async listEvents(
		accessToken: string,
		refreshToken?: string,
		maxResults: number = 10
	): Promise<CalendarEvent[]> {
		try {
			const calendar = await this.getCalendarClient(
				accessToken,
				refreshToken
			);

			const response = await calendar.events.list({
				calendarId: "primary",
				timeMin: new Date().toISOString(),
				maxResults,
				singleEvents: true,
				orderBy: "startTime",
			});

			const events = response.data.items || [];

			return events.map((event) => ({
				id: event.id,
				title: event.summary || "No Title",
				description: event.description,
				startTime: new Date(
					event.start?.dateTime || event.start?.date || ""
				),
				endTime: new Date(event.end?.dateTime || event.end?.date || ""),
				location: event.location,
				attendees: event.attendees?.map((a) => a.email || "") || [],
			}));
		} catch (error) {
			console.error("Failed to list events:", error);
			throw new Error("Failed to retrieve calendar events");
		}
	}

	/**
	 * Create a new event
	 */
	async createEvent(
		accessToken: string,
		event: CalendarEvent,
		refreshToken?: string
	): Promise<string> {
		try {
			const calendar = await this.getCalendarClient(
				accessToken,
				refreshToken
			);

			const googleEvent = {
				summary: event.title,
				description: event.description,
				location: event.location,
				start: {
					dateTime: event.startTime.toISOString(),
					timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				},
				end: {
					dateTime: event.endTime.toISOString(),
					timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				},
				attendees: event.attendees?.map((email) => ({ email })),
			};

			const response = await calendar.events.insert({
				calendarId: "primary",
				requestBody: googleEvent,
			});

			if (!response.data.id) {
				throw new Error("No event ID returned");
			}

			return response.data.id;
		} catch (error) {
			console.error("Failed to create event:", error);
			throw new Error("Failed to create calendar event");
		}
	}

	/**
	 * Update an existing event
	 */
	async updateEvent(
		accessToken: string,
		eventId: string,
		event: Partial<CalendarEvent>,
		refreshToken?: string
	): Promise<void> {
		try {
			const calendar = await this.getCalendarClient(
				accessToken,
				refreshToken
			);

			const updateData: any = {};

			if (event.title) updateData.summary = event.title;
			if (event.description) updateData.description = event.description;
			if (event.location) updateData.location = event.location;

			if (event.startTime) {
				updateData.start = {
					dateTime: event.startTime.toISOString(),
					timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				};
			}

			if (event.endTime) {
				updateData.end = {
					dateTime: event.endTime.toISOString(),
					timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				};
			}

			if (event.attendees) {
				updateData.attendees = event.attendees.map((email) => ({
					email,
				}));
			}

			await calendar.events.update({
				calendarId: "primary",
				eventId,
				requestBody: updateData,
			});
		} catch (error) {
			console.error("Failed to update event:", error);
			throw new Error("Failed to update calendar event");
		}
	}

	/**
	 * Delete an event
	 */
	async deleteEvent(
		accessToken: string,
		eventId: string,
		refreshToken?: string
	): Promise<void> {
		try {
			const calendar = await this.getCalendarClient(
				accessToken,
				refreshToken
			);

			await calendar.events.delete({
				calendarId: "primary",
				eventId,
			});
		} catch (error) {
			console.error("Failed to delete event:", error);
			throw new Error("Failed to delete calendar event");
		}
	}

	/**
	 * Check for conflicting events
	 */
	async checkConflicts(
		accessToken: string,
		startTime: Date,
		endTime: Date,
		refreshToken?: string
	): Promise<CalendarEvent[]> {
		try {
			const calendar = await this.getCalendarClient(
				accessToken,
				refreshToken
			);

			const response = await calendar.events.list({
				calendarId: "primary",
				timeMin: startTime.toISOString(),
				timeMax: endTime.toISOString(),
				singleEvents: true,
				orderBy: "startTime",
			});

			const conflicts = response.data.items || [];

			return conflicts.map((event) => ({
				id: event.id,
				title: event.summary || "No Title",
				description: event.description,
				startTime: new Date(
					event.start?.dateTime || event.start?.date || ""
				),
				endTime: new Date(event.end?.dateTime || event.end?.date || ""),
				location: event.location,
			}));
		} catch (error) {
			console.error("Failed to check conflicts:", error);
			throw new Error("Failed to check for conflicting events");
		}
	}
}
