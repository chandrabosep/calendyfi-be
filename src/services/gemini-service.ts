import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config";
import {
	ParsedAiCommand,
	GeminiApiResponse,
	AiIntent,
	AiAction,
	AiParameters,
} from "../types";

export class GeminiService {
	private genAI: GoogleGenerativeAI;
	private model: any;

	constructor() {
		this.genAI = new GoogleGenerativeAI(config.geminiApiKey);
		this.model = this.genAI.getGenerativeModel({
			model: "gemini-2.0-flash-exp",
		});
	}

	/**
	 * Parse user text to extract intent, action, and parameters
	 */
	async parseAiCommand(
		userText: string,
		userId: string,
		eventId?: string,
		scheduledTime?: Date
	): Promise<GeminiApiResponse> {
		try {
			const prompt = this.buildParsingPrompt(userText, scheduledTime);

			const result = await this.model.generateContent(prompt);
			const response = await result.response;
			const text = response.text();

			// Parse the JSON response from Gemini
			const parsedCommand = this.parseGeminiResponse(
				text,
				userText,
				userId,
				eventId,
				scheduledTime
			);

			console.info("Successfully parsed AI command", {
				userId,
				intent: parsedCommand.intent.type,
				action: parsedCommand.action.type,
				confidence: parsedCommand.confidence,
				scheduledTime: parsedCommand.scheduledTime?.toISOString(),
			});

			return {
				success: true,
				parsedCommand,
			};
		} catch (error) {
			console.error("Failed to parse AI command with Gemini", {
				error,
				userId,
				userText: userText.substring(0, 100), // Log first 100 chars for debugging
			});

			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	/**
	 * Build the prompt for Gemini to parse AI commands
	 */
	private buildParsingPrompt(userText: string, scheduledTime?: Date): string {
		const scheduledTimeInfo = scheduledTime
			? `\nIMPORTANT: This command is scheduled to execute at: ${scheduledTime.toISOString()} (${scheduledTime.toLocaleString()}). You MUST use this exact time in your response.`
			: "\nIMPORTANT: This command has no scheduled time - it should execute immediately.";

		return `
You are an AI assistant that specializes in parsing cryptocurrency and DeFi commands from user text. 
Your task is to extract structured information from user commands that start with "@ai".${scheduledTimeInfo}

Parse the following user text and return a JSON object with the following structure:

{
  "intent": {
    "type": "payment" | "transfer" | "swap" | "defi" | "stake" | "deposit" | "split" | "price_trigger" | "unknown",
    "description": "Brief description of what the user wants to do"
  },
  "action": {
    "type": "send" | "pay" | "swap" | "stake" | "deposit" | "split" | "convert" | "price_trigger" | "unknown",
    "description": "Specific action to be performed"
  },
  "parameters": {
    "amount": {
      "value": number,
      "currency": "string (e.g., USDC, ETH, BTC)",
      "unit": "string (optional)"
    },
    "recipient": {
      "address": "string (wallet address)",
      "ens": "string (ENS name like vitalik.eth)",
      "username": "string (username like @alice)",
      "chain": "string (blockchain network)"
    },
    "fromToken": "string (source token)",
    "toToken": "string (destination token)",
    "protocol": "string (protocol name like 1inch)",
    "chain": "string (blockchain network)",
    "participants": ["string array of usernames for splits"],
    "splitAmount": number,
    "pool": "string (staking pool name)",
    "platform": "string (platform name)",
    "priceTrigger": {
      "triggerType": "above" | "below" | "equals",
      "targetPrice": number,
      "fromToken": "string (token to monitor)",
      "toToken": "string (token to swap to)",
      "amount": "string (amount to swap)"
    }
  },
  "confidence": number (0-1, how confident you are in the parsing),
  "scheduledTime": "string (ISO 8601 format of when this transaction should execute)"
}

Examples of commands to parse:

1. "@ai send 1 USDC to vitalik.eth"
   - Intent: transfer, Action: send
   - Amount: 1 USDC, Recipient: vitalik.eth, Chain: Sepolia (default)

2. "@ai swap 50 USDC to ETH using 1inch"
   - Intent: swap, Action: swap
   - Amount: 50 USDC, FromToken: USDC, ToToken: ETH, Protocol: 1inch, Chain: Sepolia (default)

3. "@ai split 200 USDC between @alice and @bob"
   - Intent: split, Action: split
   - Amount: 200 USDC, Participants: ["@alice", "@bob"], Chain: Sepolia (default)

4. "@ai stake 100 USDC into Flow staking pool"
   - Intent: defi, Action: stake
   - Amount: 100 USDC, Pool: Flow staking pool, Chain: Sepolia (default)

5. "@ai pay 0.01 RBTC on Rootstock to satoshi.rsk"
   - Intent: payment, Action: pay
   - Amount: 0.01 RBTC, Chain: Rootstock, Recipient: satoshi.rsk

5b. "@ai send 0.000001 RBTC to alice.rsk on Rootstock"
   - Intent: transfer, Action: send
   - Amount: 0.000001 RBTC, Chain: Rootstock, Recipient: alice.rsk
   - recipient: { ens: "alice.rsk", address: null, username: null, chain: "Rootstock" }

6. "@ai send 100 RIF to alice.rsk on Rootstock"
   - Intent: transfer, Action: send
   - Amount: 100 RIF, Chain: Rootstock, Recipient: alice.rsk

7. "@ai swap 100 USDC to RBTC on Rootstock"
   - Intent: swap, Action: swap
   - Amount: 100 USDC, FromToken: USDC, ToToken: RBTC, Chain: Rootstock

8. "@ai send 0.001 FLOW to bob.eth on Flow"
   - Intent: transfer, Action: send
   - Amount: 0.001 FLOW, Chain: Flow, Recipient: bob.eth

9. "@ai if ETH hits $3000 then swap 1 ETH to USDC"
   - Intent: price_trigger, Action: price_trigger
   - priceTrigger: { triggerType: "above", targetPrice: 3000, fromToken: "ETH", toToken: "USDC", amount: "1" }

10. "@ai when RBTC goes below $50000 swap 0.1 RBTC to RIF"
   - Intent: price_trigger, Action: price_trigger
   - priceTrigger: { triggerType: "below", targetPrice: 50000, fromToken: "RBTC", toToken: "RIF", amount: "0.1" }

11. "@ai if AAPL hits $200 then swap 10 AAPL to USDC"
   - Intent: price_trigger, Action: price_trigger
   - priceTrigger: { triggerType: "above", targetPrice: 200, fromToken: "AAPL", toToken: "USDC", amount: "10" }

12. "@ai when TSLA goes below $150 swap 5 TSLA to SPY"
   - Intent: price_trigger, Action: price_trigger
   - priceTrigger: { triggerType: "below", targetPrice: 150, fromToken: "TSLA", toToken: "SPY", amount: "5" }

SUPPORTED ASSETS:

STOCKS (via Polygon.io):
- AAPL (Apple), GOOGL (Alphabet), MSFT (Microsoft), TSLA (Tesla)
- AMZN (Amazon), NVDA (NVIDIA), META (Meta), NFLX (Netflix)
- SPY (S&P 500 ETF), QQQ (Nasdaq ETF)

CRYPTO (via Polygon.io + CoinGecko):
- BTC (Bitcoin), ETH (Ethereum), ADA (Cardano), SOL (Solana)
- MATIC (Polygon), AVAX (Avalanche), DOT (Polkadot), LINK (Chainlink)
- UNI (Uniswap), LTC (Litecoin)

BLOCKCHAIN TOKENS:
- Sepolia: ETH (native), USDC, USDT, DAI
- Rootstock: RBTC (native), RIF
- Flow EVM: FLOW (native)

IMPORTANT: Always use the exact token symbols listed above. For Rootstock Bitcoin, use "RBTC" (not "TRBTC" or "TestRBTC").

SUPPORTED NAME SERVICES:
- ENS: *.eth (Ethereum/Sepolia) - e.g., vitalik.eth, alice.eth
- RNS: *.rsk (Rootstock) - e.g., alice.rsk, bob.rsk

IMPORTANT: There is NO RIF name service. Use .rsk domains for Rootstock, not .rif domains.

IMPORTANT: For recipient parsing:
- If recipient is an ENS name (*.eth), put it in recipient.ens field
- If recipient is an RNS name (*.rsk), put it in recipient.ens field  
- If recipient is a wallet address (0x...), put it in recipient.address field
- If recipient is a username (@alice), put it in recipient.username field
- Always set recipient.chain to match the blockchain network

IMPORTANT: For swap commands, always extract the fromToken from the amount currency. 
If the command says "swap 100 USDC to ETH", then fromToken should be "USDC".

IMPORTANT: Always include the scheduledTime field in your response. If a scheduled time is provided above, you MUST use that exact time (copy it exactly). If no scheduled time is provided, set it to null.

IMPORTANT: Always use testnet chains for development. If no blockchain chain is mentioned in the command, default to "Sepolia" for the chain field. For Rootstock, always use "Rootstock" (which maps to testnet).

User text to parse: "${userText}"

Return ONLY the JSON object, no additional text or explanations.`;
	}

	/**
	 * Parse Gemini's response and create structured command object
	 */
	private parseGeminiResponse(
		geminiText: string,
		originalText: string,
		userId: string,
		eventId?: string,
		scheduledTime?: Date
	): ParsedAiCommand {
		try {
			// Clean the response text (remove markdown formatting if present)
			const cleanText = geminiText
				.replace(/```json\n?/g, "")
				.replace(/```\n?/g, "")
				.trim();

			const parsed = JSON.parse(cleanText);

			// Validate and structure the response
			const intent: AiIntent = {
				type: parsed.intent?.type || "unknown",
				description: parsed.intent?.description || "Unknown intent",
			};

			const action: AiAction = {
				type: parsed.action?.type || "unknown",
				description: parsed.action?.description || "Unknown action",
			};

			const parameters: AiParameters = {
				amount: parsed.parameters?.amount
					? {
							value: parsed.parameters.amount.value || 0,
							currency: parsed.parameters.amount.currency || "",
							unit: parsed.parameters.amount.unit,
					  }
					: undefined,
				recipient: parsed.parameters?.recipient
					? {
							address: parsed.parameters.recipient.address,
							ens: parsed.parameters.recipient.ens,
							username: parsed.parameters.recipient.username,
							chain:
								parsed.parameters.recipient.chain || "Sepolia",
					  }
					: undefined,
				fromToken: parsed.parameters?.fromToken,
				toToken: parsed.parameters?.toToken,
				protocol: parsed.parameters?.protocol,
				chain: parsed.parameters?.chain || "Sepolia",
				participants: parsed.parameters?.participants,
				splitAmount: parsed.parameters?.splitAmount,
				pool: parsed.parameters?.pool,
				platform: parsed.parameters?.platform,
			};

			return {
				intent,
				action,
				parameters,
				confidence: parsed.confidence || 0.5,
				rawText: originalText,
				userId,
				eventId,
				scheduledTime:
					scheduledTime ||
					(parsed.scheduledTime
						? new Date(parsed.scheduledTime)
						: undefined),
			};
		} catch (error) {
			console.error("Failed to parse Gemini response", {
				error,
				geminiText: geminiText.substring(0, 200),
				userId,
			});

			// Return a fallback parsed command
			return {
				intent: {
					type: "unknown",
					description: "Failed to parse intent",
				},
				action: {
					type: "unknown",
					description: "Failed to parse action",
				},
				parameters: {},
				confidence: 0,
				rawText: originalText,
				userId,
				eventId,
				scheduledTime,
			};
		}
	}
}

export function createGeminiService(): GeminiService {
	return new GeminiService();
}
