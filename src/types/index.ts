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

// API Response Types
export interface ApiResponse<T = any> {
	success: boolean;
	data?: T;
	error?: string;
	message?: string;
}

// AI Command Parsing Types
export interface ParsedAiCommand {
	intent: AiIntent;
	action: AiAction;
	parameters: AiParameters;
	confidence: number;
	rawText: string;
	userId: string;
	eventId?: string;
	scheduledTime?: Date;
}

export interface AiIntent {
	type:
		| "payment"
		| "transfer"
		| "swap"
		| "defi"
		| "stake"
		| "deposit"
		| "split"
		| "unknown";
	description: string;
}

export interface AiAction {
	type:
		| "send"
		| "pay"
		| "swap"
		| "stake"
		| "deposit"
		| "split"
		| "convert"
		| "unknown";
	description: string;
}

export interface AiParameters {
	amount?: {
		value: number;
		currency: string;
		unit?: string;
	};
	recipient?: {
		address?: string;
		ens?: string;
		username?: string;
		chain?: string;
	};
	fromToken?: string;
	toToken?: string;
	protocol?: string;
	chain?: string;
	participants?: string[];
	splitAmount?: number;
	pool?: string;
	platform?: string;
}

export interface GeminiApiResponse {
	success: boolean;
	parsedCommand?: ParsedAiCommand;
	error?: string;
}

// Configuration Types
export interface ChainConfig {
	chainId: number;
	name: string;
	rpcUrl: string;
	deployerPrivateKey: string;
	safeSupported?: boolean; // Whether Safe Protocol Kit supports this chain
	safeProxyFactory?: string;
	safeMasterCopy?: string;
	fallbackHandler?: string;
	paymentToken?: string;
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
	chains: ChainConfig[];
	defaultChainId: number;
}

// Flow Scheduling Types
export interface FlowScheduledPayment {
	id: string;
	recipient: string;
	amount: string;
	delaySeconds: number;
	scheduledTime: Date;
	executed: boolean;
	sender?: string;
	cadenceTxId?: string;
	evmTxId?: string;
	createdAt: Date;
	updatedAt?: Date;
}

export interface FlowScheduleRequest {
	recipient: string;
	amount: string;
	delaySeconds: number;
	userId: string;
	eventId?: string;
	description?: string;
}

export interface FlowScheduleResponse {
	success: boolean;
	scheduleId?: string;
	evmTxHash?: string;
	cadenceTxId?: string;
	scheduledTime?: Date;
	error?: string;
}

export interface FlowExecutionResult {
	success: boolean;
	txId?: string;
	transactionHash?: string;
	error?: string;
	executedAt?: Date;
}

// Advanced Scheduling Types
export interface RecurringSchedule {
	type: "daily" | "weekly" | "monthly" | "yearly" | "custom";
	interval: number; // Every X days/weeks/months/years
	startDate: Date;
	endDate?: Date; // Optional end date
	daysOfWeek?: number[]; // 0-6 (Sunday-Saturday) for weekly schedules
	dayOfMonth?: number; // 1-31 for monthly schedules
	timeOfDay?: string; // HH:MM format
	timezone?: string;
}

export interface CustomSchedule {
	type: "custom";
	pattern: string; // Natural language pattern like "every 5 minutes", "every week for 3 months"
	startDate: Date;
	endDate?: Date;
	timezone?: string;
}

export interface AdvancedScheduleRequest {
	recipient: string;
	amount: string;
	userId: string;
	eventId?: string;
	description?: string;
	method?: "evm" | "cadence";
	scheduleType: "once" | "recurring" | "custom";
	// For one-time scheduling
	delaySeconds?: number;
	scheduledTime?: Date;
	// For recurring scheduling
	recurringSchedule?: RecurringSchedule;
	// For custom scheduling
	customSchedule?: CustomSchedule;
}

export interface SchedulePattern {
	pattern: string;
	nextExecution: Date;
	remainingExecutions?: number;
	isValid: boolean;
	error?: string;
}

export interface ParsedSchedule {
	type: "once" | "recurring" | "custom";
	executions: Date[];
	pattern?: string;
	error?: string;
}

// EVM Bridge Types
export interface EVMBridgeConfig {
	contractAddress: string;
	cadenceAddress: string;
	rpcUrl: string;
	chainId: number;
	explorerBase: string;
}

export interface EVMSchedule {
	id: string;
	recipient: string;
	amount: string;
	delaySeconds: number;
	createdAt: Date;
	creator: string;
	bridgeTriggered: boolean;
	executed: boolean;
	evmTxHash?: string;
	cadenceTxId?: string;
}

export interface EVMScheduleRequest {
	recipient: string;
	amount: string;
	delaySeconds: number;
	userId?: string;
	eventId?: string;
}

export interface EVMBridgeEvent {
	scheduleId: string;
	recipient: string;
	amount: string;
	delaySeconds: number;
	timestamp: number;
	caller: string;
	blockNumber: number;
	transactionHash: string;
}

export interface BridgeCallRequest {
	scheduleId: string;
	recipient: string;
	amount: string;
	delaySeconds: number;
	evmTxHash: string;
	blockNumber: number;
}

export interface BridgeExecutionResult {
	success: boolean;
	cadenceTxId?: string;
	error?: string;
	executedAt?: Date;
}

export interface EVMContractABI {
	schedulePayment: string;
	getSchedule: string;
	getSchedulesByCreator: string;
	getTotalSchedules: string;
	events: {
		BridgeCallRequested: string;
		ScheduleCreated: string;
	};
}

// Multi-Chain Scheduling Types
export interface MultiChainScheduleRequest {
	recipient: string;
	amount: string;
	userId: string;
	eventId?: string;
	description?: string;
	scheduleType: "once" | "recurring" | "custom";
	chains: number[];
	// For one-time scheduling
	delaySeconds?: number;
	scheduledTime?: Date;
	// For recurring scheduling
	recurringSchedule?: RecurringSchedule;
	// For custom scheduling
	customSchedule?: CustomSchedule;
}

export interface MultiChainScheduleResult {
	success: boolean;
	results: Record<string, ChainScheduleResult>;
	totalSchedules: number;
	successfulChains: number;
	failedChains: number;
	error?: string;
}

export interface ChainScheduleResult {
	success: boolean;
	scheduleIds?: string[];
	txHashes?: string[];
	scheduledTimes?: Date[];
	error?: string;
}
