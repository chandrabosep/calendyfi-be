import { ParsedAiCommand, AiIntent, AiAction, AiParameters } from "../types";
import { GeminiService } from "./gemini-service";

export class AiEventProcessor {
	private geminiService: GeminiService;

	constructor() {
		this.geminiService = new GeminiService();
	}

	/**
	 * Process an AI event by parsing the command and determining next steps
	 */
	async processAiEvent(
		eventText: string,
		userId: string,
		eventId?: string,
		scheduledTime?: Date
	): Promise<{
		success: boolean;
		parsedCommand?: ParsedAiCommand;
		nextSteps?: string[];
		error?: string;
	}> {
		try {
			console.info("Processing AI event", {
				userId,
				eventId,
				eventText: eventText.substring(0, 100),
				scheduledTime: scheduledTime?.toISOString(),
				scheduledTimeProvided: !!scheduledTime,
			});

			// Parse the command using Gemini
			const parseResult = await this.geminiService.parseAiCommand(
				eventText,
				userId,
				eventId,
				scheduledTime
			);

			if (!parseResult.success || !parseResult.parsedCommand) {
				return {
					success: false,
					error: parseResult.error || "Failed to parse command",
				};
			}

			const parsedCommand = parseResult.parsedCommand;

			// Determine next steps based on the parsed command
			const nextSteps = this.determineNextSteps(parsedCommand);

			// Log the successful processing
			console.info("AI event processed successfully", {
				userId,
				eventId,
				intent: parsedCommand.intent.type,
				action: parsedCommand.action.type,
				confidence: parsedCommand.confidence,
				scheduledTime: parsedCommand.scheduledTime?.toISOString(),
				nextStepsCount: nextSteps.length,
			});

			return {
				success: true,
				parsedCommand,
				nextSteps,
			};
		} catch (error) {
			console.error("Failed to process AI event", {
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

	/**
	 * Determine the next steps based on the parsed command
	 */
	private determineNextSteps(parsedCommand: ParsedAiCommand): string[] {
		const { intent, action, parameters } = parsedCommand;
		const steps: string[] = [];

		// Add validation steps
		steps.push("Validate user wallet connection");
		steps.push("Check sufficient balance for transaction");

		// Add intent-specific steps
		switch (intent.type) {
			case "payment":
			case "transfer":
				steps.push("Resolve recipient address (ENS/username)");
				steps.push("Validate recipient address format");
				steps.push("Calculate gas fees");
				steps.push("Execute transfer transaction");
				break;

			case "swap":
				steps.push("Get current exchange rates");
				steps.push("Calculate optimal swap route");
				steps.push("Approve token spending (if needed)");
				steps.push("Execute swap transaction");
				break;

			case "split":
				steps.push("Resolve all participant addresses");
				steps.push("Calculate individual amounts");
				steps.push("Validate all recipient addresses");
				steps.push("Execute batch transfer");
				break;

			case "defi":
			case "stake":
				steps.push("Connect to staking protocol");
				steps.push("Approve token spending");
				steps.push("Execute staking transaction");
				steps.push("Monitor staking status");
				break;

			case "deposit":
				steps.push("Connect to lending protocol");
				steps.push("Approve token spending");
				steps.push("Execute deposit transaction");
				steps.push("Update lending position");
				break;

			default:
				steps.push("Determine appropriate action");
				steps.push("Execute command");
		}

		// Add post-execution steps
		steps.push("Monitor transaction status");
		steps.push("Update user balance");
		steps.push("Log transaction details");
		steps.push("Send confirmation notification");

		return steps;
	}
}

export function createAiEventProcessor(): AiEventProcessor {
	return new AiEventProcessor();
}
