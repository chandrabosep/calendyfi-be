import { GoogleGenerativeAI } from "@google/generative-ai";

export interface ParsedEventData {
	title: string;
	description?: string;
	startTime: string; // ISO string
	endTime: string; // ISO string
	location?: string;
	attendees?: string[];
	confidence: number; // 0-1 scale
	suggestions?: string[];
}

export class GeminiService {
	private genAI: GoogleGenerativeAI;
	private model;

	constructor() {
		if (!process.env.GOOGLE_AI_API_KEY) {
			throw new Error("GOOGLE_AI_API_KEY is required");
		}

		this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
		this.model = this.genAI.getGenerativeModel({ model: "gemini-pro" });
	}

	/**
	 * Parse natural language input into structured event data
	 */
	async parseEventFromText(input: string): Promise<ParsedEventData> {
		try {
			const prompt = `
Parse the following natural language text into a structured calendar event. 
Extract all relevant information and provide confidence scores.

Input: "${input}"

Please respond with a JSON object in this exact format:
{
  "title": "Event title",
  "description": "Event description (optional)",
  "startTime": "ISO 8601 datetime string",
  "endTime": "ISO 8601 datetime string", 
  "location": "Location (if mentioned)",
  "attendees": ["email@example.com"] (if mentioned),
  "confidence": 0.95,
  "suggestions": ["suggestion 1", "suggestion 2"]
}

Rules:
- Use current date/time as reference if not specified
- Default duration is 1 hour if not specified
- Confidence should be 0-1 based on how clear the input is
- Include suggestions for clarification if needed
- Always provide valid ISO 8601 datetime strings
- If no time specified, suggest a reasonable default

Current datetime for reference: ${new Date().toISOString()}
`;

			const result = await this.model.generateContent(prompt);
			const response = await result.response;
			const text = response.text();

			// Extract JSON from response
			const jsonMatch = text.match(/\{[\s\S]*\}/);
			if (!jsonMatch) {
				throw new Error("Invalid response format from AI");
			}

			const parsed = JSON.parse(jsonMatch[0]);

			// Validate required fields
			if (!parsed.title || !parsed.startTime || !parsed.endTime) {
				throw new Error("Missing required event fields");
			}

			// Ensure valid date strings
			new Date(parsed.startTime);
			new Date(parsed.endTime);

			return {
				title: parsed.title,
				description: parsed.description,
				startTime: parsed.startTime,
				endTime: parsed.endTime,
				location: parsed.location,
				attendees: parsed.attendees || [],
				confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
				suggestions: parsed.suggestions || [],
			};
		} catch (error) {
			console.error("Failed to parse event:", error);
			throw new Error("Failed to parse event from natural language");
		}
	}

	/**
	 * Generate smart event suggestions based on user patterns
	 */
	async generateEventSuggestions(
		userHistory: Array<{ title: string; startTime: Date; endTime: Date }>,
		context?: string
	): Promise<string[]> {
		try {
			const historyText = userHistory
				.slice(-10) // Last 10 events
				.map(
					(event) =>
						`${event.title} (${event.startTime.toDateString()})`
				)
				.join("\n");

			const prompt = `
Based on the user's recent calendar events, suggest 3-5 relevant upcoming events they might want to schedule.

Recent events:
${historyText}

Additional context: ${context || "None"}

Provide suggestions as a JSON array of strings, each being a natural language event description.
Example: ["Team standup meeting tomorrow at 9 AM", "Follow-up call with client next week"]

Focus on:
- Work meetings and follow-ups
- Regular recurring events
- Project deadlines
- Social activities

Respond with only the JSON array.
`;

			const result = await this.model.generateContent(prompt);
			const response = await result.response;
			const text = response.text();

			// Extract JSON array from response
			const jsonMatch = text.match(/\[[\s\S]*\]/);
			if (!jsonMatch) {
				return [];
			}

			const suggestions = JSON.parse(jsonMatch[0]);
			return Array.isArray(suggestions) ? suggestions : [];
		} catch (error) {
			console.error("Failed to generate suggestions:", error);
			return [];
		}
	}

	/**
	 * Analyze event conflicts and provide resolution suggestions
	 */
	async analyzeConflicts(
		newEvent: { title: string; startTime: Date; endTime: Date },
		conflicts: Array<{ title: string; startTime: Date; endTime: Date }>
	): Promise<{
		severity: "low" | "medium" | "high";
		suggestions: string[];
	}> {
		try {
			const conflictText = conflicts
				.map(
					(c) =>
						`${
							c.title
						} (${c.startTime.toLocaleString()} - ${c.endTime.toLocaleString()})`
				)
				.join("\n");

			const prompt = `
Analyze this scheduling conflict and provide resolution suggestions.

New Event: ${
				newEvent.title
			} (${newEvent.startTime.toLocaleString()} - ${newEvent.endTime.toLocaleString()})

Conflicting Events:
${conflictText}

Respond with JSON in this format:
{
  "severity": "low|medium|high",
  "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"]
}

Severity guidelines:
- low: Minor overlap or buffer time conflict
- medium: Significant overlap but potentially manageable
- high: Complete overlap or critical conflict

Suggestions should be practical and specific.
`;

			const result = await this.model.generateContent(prompt);
			const response = await result.response;
			const text = response.text();

			const jsonMatch = text.match(/\{[\s\S]*\}/);
			if (!jsonMatch) {
				return {
					severity: "medium",
					suggestions: ["Please resolve manually"],
				};
			}

			const analysis = JSON.parse(jsonMatch[0]);

			return {
				severity: analysis.severity || "medium",
				suggestions: Array.isArray(analysis.suggestions)
					? analysis.suggestions
					: [],
			};
		} catch (error) {
			console.error("Failed to analyze conflicts:", error);
			return {
				severity: "medium",
				suggestions: ["Unable to analyze conflict automatically"],
			};
		}
	}

	/**
	 * Optimize event timing based on preferences and patterns
	 */
	async optimizeEventTiming(
		eventText: string,
		userPreferences: {
			workingHours?: { start: string; end: string };
			timeZone?: string;
			preferredMeetingDuration?: number;
		}
	): Promise<{
		originalParsing: ParsedEventData;
		optimizedSuggestions: Array<{
			startTime: string;
			endTime: string;
			reason: string;
		}>;
	}> {
		try {
			// First parse the original event
			const originalParsing = await this.parseEventFromText(eventText);

			const prompt = `
Given this event and user preferences, suggest optimized timing options.

Event: ${JSON.stringify(originalParsing)}
User Preferences: ${JSON.stringify(userPreferences)}

Provide 2-3 alternative timing suggestions that respect user preferences.

Respond with JSON:
{
  "optimizedSuggestions": [
    {
      "startTime": "ISO datetime",
      "endTime": "ISO datetime", 
      "reason": "Why this timing is better"
    }
  ]
}
`;

			const result = await this.model.generateContent(prompt);
			const response = await result.response;
			const text = response.text();

			const jsonMatch = text.match(/\{[\s\S]*\}/);
			if (!jsonMatch) {
				return { originalParsing, optimizedSuggestions: [] };
			}

			const optimization = JSON.parse(jsonMatch[0]);

			return {
				originalParsing,
				optimizedSuggestions: optimization.optimizedSuggestions || [],
			};
		} catch (error) {
			console.error("Failed to optimize timing:", error);
			const originalParsing = await this.parseEventFromText(eventText);
			return { originalParsing, optimizedSuggestions: [] };
		}
	}
}
