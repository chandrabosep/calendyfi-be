import {
	RecurringSchedule,
	CustomSchedule,
	ParsedSchedule,
	SchedulePattern,
} from "../types";

/**
 * Utility class for parsing and calculating scheduling patterns
 */
export class ScheduleParser {
	/**
	 * Parse natural language scheduling patterns
	 */
	static parseNaturalLanguage(
		pattern: string,
		startDate: Date = new Date()
	): ParsedSchedule {
		const normalizedPattern = pattern.toLowerCase().trim();

		try {
			// Handle "after X minutes/hours/days" patterns
			if (normalizedPattern.startsWith("after")) {
				return this.parseAfterPattern(normalizedPattern, startDate);
			}

			// Handle "every X minutes/hours/days/weeks/months" patterns
			if (normalizedPattern.startsWith("every")) {
				return this.parseEveryPattern(normalizedPattern, startDate);
			}

			// Handle "every day until X" patterns
			if (
				normalizedPattern.includes("every day") &&
				normalizedPattern.includes("until")
			) {
				return this.parseDailyUntilPattern(
					normalizedPattern,
					startDate
				);
			}

			// Handle "every week for X months" patterns
			if (
				normalizedPattern.includes("every week") &&
				normalizedPattern.includes("for")
			) {
				return this.parseWeeklyForPattern(normalizedPattern, startDate);
			}

			// Handle "every month" patterns
			if (normalizedPattern.includes("every month")) {
				return this.parseMonthlyPattern(normalizedPattern, startDate);
			}

			return {
				type: "once",
				executions: [startDate],
				error: `Unsupported pattern: ${pattern}`,
			};
		} catch (error) {
			return {
				type: "once",
				executions: [startDate],
				error: `Failed to parse pattern: ${
					error instanceof Error ? error.message : "Unknown error"
				}`,
			};
		}
	}

	/**
	 * Parse "after X minutes/hours/days" patterns
	 */
	private static parseAfterPattern(
		pattern: string,
		startDate: Date
	): ParsedSchedule {
		const match = pattern.match(
			/after\s+(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks|month|months)/
		);
		if (!match) {
			return {
				type: "once",
				executions: [startDate],
				error: 'Invalid "after" pattern format',
			};
		}

		const value = parseInt(match[1]);
		const unit = match[2];

		let delayMs = 0;
		switch (unit) {
			case "minute":
			case "minutes":
				delayMs = value * 60 * 1000;
				break;
			case "hour":
			case "hours":
				delayMs = value * 60 * 60 * 1000;
				break;
			case "day":
			case "days":
				delayMs = value * 24 * 60 * 60 * 1000;
				break;
			case "week":
			case "weeks":
				delayMs = value * 7 * 24 * 60 * 60 * 1000;
				break;
			case "month":
			case "months":
				delayMs = value * 30 * 24 * 60 * 60 * 1000; // Approximate
				break;
		}

		const executionTime = new Date(startDate.getTime() + delayMs);
		return {
			type: "once",
			executions: [executionTime],
		};
	}

	/**
	 * Parse "every X minutes/hours/days/weeks/months" patterns
	 */
	private static parseEveryPattern(
		pattern: string,
		startDate: Date
	): ParsedSchedule {
		// Handle "every 1min" or "every 1 minute"
		if (pattern.includes("min")) {
			const match = pattern.match(/every\s+(\d+)\s*min/);
			if (match) {
				const minutes = parseInt(match[1]);
				return this.generateRecurringExecutions(
					startDate,
					minutes * 60 * 1000,
					100
				); // Generate 100 executions
			}
		}

		// Handle "every 5min" or "every 5 minutes"
		if (pattern.includes("minute")) {
			const match = pattern.match(/every\s+(\d+)\s+minute/);
			if (match) {
				const minutes = parseInt(match[1]);
				return this.generateRecurringExecutions(
					startDate,
					minutes * 60 * 1000,
					100
				);
			}
		}

		// Handle "every day"
		if (pattern.includes("every day")) {
			return this.generateRecurringExecutions(
				startDate,
				24 * 60 * 60 * 1000,
				365
			); // Daily for a year
		}

		// Handle "every week"
		if (pattern.includes("every week")) {
			return this.generateRecurringExecutions(
				startDate,
				7 * 24 * 60 * 60 * 1000,
				52
			); // Weekly for a year
		}

		// Handle "every month"
		if (pattern.includes("every month")) {
			return this.generateRecurringExecutions(
				startDate,
				30 * 24 * 60 * 60 * 1000,
				12
			); // Monthly for a year
		}

		return {
			type: "once",
			executions: [startDate],
			error: `Unsupported "every" pattern: ${pattern}`,
		};
	}

	/**
	 * Parse "every day until X" patterns
	 */
	private static parseDailyUntilPattern(
		pattern: string,
		startDate: Date
	): ParsedSchedule {
		const untilMatch = pattern.match(/until\s+(\d{4}-\d{2}-\d{2})/);
		if (!untilMatch || !untilMatch[1]) {
			return {
				type: "once",
				executions: [startDate],
				error: 'Invalid "until" date format. Use YYYY-MM-DD',
			};
		}

		const endDate = new Date(untilMatch[1]);
		const executions: Date[] = [];
		const currentDate = new Date(startDate);

		while (currentDate <= endDate) {
			executions.push(new Date(currentDate));
			currentDate.setDate(currentDate.getDate() + 1);
		}

		return {
			type: "recurring",
			executions,
			pattern: `Daily until ${untilMatch[1]}`,
		};
	}

	/**
	 * Parse "every week for X months" patterns
	 */
	private static parseWeeklyForPattern(
		pattern: string,
		startDate: Date
	): ParsedSchedule {
		const forMatch = pattern.match(/for\s+(\d+)\s+month/);
		if (!forMatch || !forMatch[1]) {
			return {
				type: "once",
				executions: [startDate],
				error: 'Invalid "for" duration format',
			};
		}

		const months = parseInt(forMatch[1]);
		const endDate = new Date(startDate);
		endDate.setMonth(endDate.getMonth() + months);

		const executions: Date[] = [];
		const currentDate = new Date(startDate);

		while (currentDate <= endDate) {
			executions.push(new Date(currentDate));
			currentDate.setDate(currentDate.getDate() + 7); // Add 7 days for weekly
		}

		return {
			type: "recurring",
			executions,
			pattern: `Weekly for ${months} months`,
		};
	}

	/**
	 * Parse monthly patterns
	 */
	private static parseMonthlyPattern(
		pattern: string,
		startDate: Date
	): ParsedSchedule {
		const executions: Date[] = [];
		const currentDate = new Date(startDate);

		// Generate monthly executions for a year
		for (let i = 0; i < 12; i++) {
			executions.push(new Date(currentDate));
			currentDate.setMonth(currentDate.getMonth() + 1);
		}

		return {
			type: "recurring",
			executions,
			pattern: "Monthly",
		};
	}

	/**
	 * Generate recurring executions with given interval
	 */
	private static generateRecurringExecutions(
		startDate: Date,
		intervalMs: number,
		maxExecutions: number
	): ParsedSchedule {
		const executions: Date[] = [];
		const currentDate = new Date(startDate);

		for (let i = 0; i < maxExecutions; i++) {
			executions.push(new Date(currentDate));
			currentDate.setTime(currentDate.getTime() + intervalMs);
		}

		return {
			type: "recurring",
			executions,
			pattern: `Every ${intervalMs / 1000} seconds`,
		};
	}

	/**
	 * Calculate next execution time for recurring schedules
	 */
	static calculateNextExecution(
		schedule: RecurringSchedule,
		lastExecution?: Date
	): Date {
		const now = new Date();
		const startDate = schedule.startDate;
		const interval = schedule.interval;

		// If we have an end date and it's passed, return null
		if (schedule.endDate && now > schedule.endDate) {
			throw new Error("Schedule has ended");
		}

		let nextExecution: Date;

		if (lastExecution) {
			nextExecution = new Date(lastExecution);
		} else {
			nextExecution = new Date(startDate);
		}

		switch (schedule.type) {
			case "daily":
				nextExecution.setDate(nextExecution.getDate() + interval);
				break;
			case "weekly":
				nextExecution.setDate(nextExecution.getDate() + interval * 7);
				break;
			case "monthly":
				nextExecution.setMonth(nextExecution.getMonth() + interval);
				break;
			case "yearly":
				nextExecution.setFullYear(
					nextExecution.getFullYear() + interval
				);
				break;
			default:
				throw new Error(`Unsupported schedule type: ${schedule.type}`);
		}

		// Apply time of day if specified
		if (schedule.timeOfDay) {
			const timeParts = schedule.timeOfDay.split(":");
			if (timeParts.length === 2) {
				const hours = parseInt(timeParts[0]);
				const minutes = parseInt(timeParts[1]);
				nextExecution.setHours(hours, minutes, 0, 0);
			}
		}

		return nextExecution;
	}

	/**
	 * Validate a schedule pattern
	 */
	static validatePattern(pattern: string): SchedulePattern {
		try {
			const parsed = this.parseNaturalLanguage(pattern);

			if (parsed.error) {
				return {
					pattern,
					nextExecution: new Date(),
					isValid: false,
					error: parsed.error,
				};
			}

			return {
				pattern,
				nextExecution: parsed.executions[0] || new Date(),
				remainingExecutions: parsed.executions.length,
				isValid: true,
			};
		} catch (error) {
			return {
				pattern,
				nextExecution: new Date(),
				isValid: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	/**
	 * Convert relative time to absolute timestamp for Flow scheduling
	 */
	static calculateFlowTimestamp(executionTime: Date): number {
		return Math.floor(executionTime.getTime() / 1000);
	}

	/**
	 * Calculate delay seconds from now to execution time
	 */
	static calculateDelaySeconds(executionTime: Date): number {
		const now = new Date();
		const delayMs = executionTime.getTime() - now.getTime();
		return Math.max(0, Math.floor(delayMs / 1000));
	}
}
