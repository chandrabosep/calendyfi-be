// Google Calendar API Types
export interface GoogleCalendarEvent {
	id: string;
	summary: string;
	description?: string;
	start: {
		dateTime?: string;
		date?: string;
	};
	end: {
		dateTime?: string;
		date?: string;
	};
	location?: string;
	attendees?: Array<{
		email: string;
		displayName?: string;
		responseStatus?: string;
	}>;
	created?: string;
	updated?: string;
	calendarId?: string;
	calendarName?: string;
}

export interface GoogleCalendarListResponse {
	items: GoogleCalendarEvent[];
	nextPageToken?: string;
}

// OAuth Types
export interface GoogleTokens {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	token_type: string;
	scope: string;
}

export interface GoogleUserInfo {
	id: string;
	email: string;
	name: string;
	picture?: string;
}

// Webhook Types
export interface GoogleWebhookNotification {
	kind: string;
	id: string;
	resourceId: string;
	resourceUri: string;
	token: string;
	expiration: string;
}

export interface WebhookPayload {
	headers: Record<string, string>;
	body: any;
}

// API Response Types
export interface ApiResponse<T = any> {
	success: boolean;
	data?: T;
	error?: string;
	message?: string;
}

// Application Types
export interface CalendarEventData {
	googleEventId: string;
	calendarId: string;
	title: string;
	description?: string;
	startTime: Date;
	endTime: Date;
	location?: string;
	attendees?: any[];
	isAiEvent: boolean;
}

export interface UserSession {
	userId: string;
	email: string;
	googleId: string;
	accessToken: string;
	tokenExpiry: Date;
}

export interface AppConfig {
	port: number;
	nodeEnv: string;
	googleClientId: string;
	googleClientSecret: string;
	googleRedirectUri: string;
	databaseUrl: string;
	encryptionKey: string;
	webhookSecret: string;
	geminiApiKey: string;
}
