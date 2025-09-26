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

	
}
