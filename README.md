# CalendeFi ⏰💸 — Turn Your Schedule Into a DeFi Command Center

**Transform your Google Calendar into an automated DeFi command center. Every event becomes an on-chain action — from paying friends to yield farming — powered by AI, multi-chain wallets, and seamless execution.**

## 🚀 Overview

CalendeFi fuses **Calendar + AI + DeFi** to make time programmable. Link your Google Calendar, and each event is parsed with AI into actionable financial tasks executed automatically across Flow and Rootstock networks.

From bill-splitting after lunch to automated payments between meetings, your schedule literally becomes your strategy. Real-time dashboards provide transparency, while one-click onboarding gives instant access to smart wallets and agent wallets with secure signers — no coding needed.

## 📋 Contract Addresses (Testnet)

### Flow EVM Testnet

-   **EVM Scheduler Contract**: [`0x7FA7E751C514ab4CB7D0Fb64a2605B644044D917`](https://evm-testnet.flowscan.io/address/0x7FA7E751C514ab4CB7D0Fb64a2605B644044D917?tab=txs)
-   **Cadence Bridge Contract**: [`0x9f3e9372a21a4f15`](https://testnet.flowscan.io/contract/A.9f3e9372a21a4f15.NativeEVMBridge)
-   **Flow EVM RPC**: `https://testnet.evm.nodes.onflow.org`
-   **Chain ID**: `545`

### Supported Networks

-   **Sepolia Testnet**: Chain ID `11155111` (Safe Protocol Kit)
-   **Flow EVM Testnet**: Chain ID `545` (Custom Smart Accounts)
-   **Flow Cadence Testnet**: Chain ID `646` (Flow Actions)
-   **Rootstock Testnet**: Chain ID `31` (Safe Protocol Kit)

## 🏗️ Architecture

### 🤖 AI-Powered Event Intelligence

**Gemini AI Integration** ([`src/services/gemini-service.ts`](src/services/gemini-service.ts))

```typescript
// Natural language events like "Pay John $10 Friday" are parsed using Google's Gemini AI
const parseResult = await this.geminiService.parseAiCommand(
	eventText,
	userId,
	eventId,
	scheduledTime
);
```

**Smart Pattern Recognition** ([`src/services/ai-event-processor.ts`](src/services/ai-event-processor.ts))

-   Advanced parsing handles complex commands like "@ai if ETH hits $3000 then trigger alert"
-   Confidence scoring and error handling
-   50+ DeFi patterns, token symbols, and scheduling syntax

**Multi-Asset Support** ([`src/services/price-monitor.ts`](src/services/price-monitor.ts))

```typescript
// Recognizes stocks (AAPL, TSLA), crypto (BTC, ETH), and blockchain tokens (RBTC, FLOW)
const currentPrice = await this.getCurrentPrice(token, chainId);
// Real-time price monitoring via Polygon.io and CoinGecko APIs
```

### 🔐 Advanced Wallet Architecture

**Dual-Wallet System** ([`src/api/wallet.ts`](src/api/wallet.ts))

```typescript
// Each user gets a Privy-managed user wallet + an auto-generated agent wallet (EOA)
const agent = await privyService.createAgentWallet();
const deployedSafes = await safeService.deploySafe(
	chainId,
	[agent.address, privyWalletAddress], // user wallet + agent wallet as co-signers
	1 // 1-of-2 threshold
);
```

**Safe Protocol Integration** ([`src/services/wallet/safe-service.ts`](src/services/wallet/safe-service.ts))

-   Smart contracts deployed using Safe SDK with multi-signature security
-   User wallet + agent wallet as co-signers with 1-of-2 threshold
-   Multi-chain deployment across Flow EVM, Rootstock, and Sepolia

**Agent Wallet Management** ([`src/services/wallet/privy-service.ts`](src/services/wallet/privy-service.ts))

-   Private keys securely cached in-memory with database backup
-   Enables autonomous transaction signing without user intervention

### ⚡ Signature & Execution Engine

**EIP-712 Typed Data Signing** ([`src/api/wallet.ts`](src/api/wallet.ts))

```typescript
// Agent wallets sign structured transaction data using EIP-712 standard
const signature = await privyService.signTypedData(
	wallet.agentWalletId,
	chainId,
	safeDomain,
	safeTypes,
	safeTransaction.data
);
```

**Safe Transaction Flow** ([`src/services/wallet/safe-service.ts`](src/services/wallet/safe-service.ts))

```typescript
// Creates Safe transactions → generates transaction hash → agent signs with EIP-712 → executes
const safeTransaction = await this.createSafeTransaction(
	chainId,
	safeAddress,
	transactions,
	agentPrivateKey
);
const executionHash = await this.executeTransaction(
	chainId,
	safeAddress,
	safeTransaction,
	signature,
	agentPrivateKey
);
```

### 🌐 Multi-Chain Integration

**Flow EVM** ([`src/services/evm-bridge.ts`](src/services/evm-bridge.ts))

```typescript
// Primary execution layer for fast, low-cost transactions
export const EVM_BRIDGE_CONFIG: EVMBridgeConfig = {
	contractAddress: "0x7FA7E751C514ab4CB7D0Fb64a2605B644044D917",
	cadenceAddress: "0x9f3e9372a21a4f15",
	rpcUrl: "https://testnet.evm.nodes.onflow.org",
	chainId: 545,
};
```

**Rootstock (RSK)** ([`src/config/index.ts`](src/config/index.ts))

```typescript
// Bitcoin-secured smart contracts with RBTC native token
chains.push({
	chainId: 31,
	name: "Rootstock Testnet",
	rpcUrl: process.env.ROOTSTOCK_RPC_URL,
	deployerPrivateKey: process.env.ROOTSTOCK_DEPLOYER_PRIVATE_KEY,
	safeSupported: true, // Safe Protocol Kit supports Rootstock
});
```

**Cross-Chain Bridge** ([`src/services/evm-bridge.ts`](src/services/evm-bridge.ts))

```typescript
// EVM bridge service enables Flow ↔ EVM communication
const CADENCE_SCHEDULE_TRANSACTION = `
import NativeEVMBridge from 0x9f3e9372a21a4f15

transaction(recipient: String, amount: UInt256, delaySeconds: UInt64, evmTxHash: String) {
    prepare(signer: AuthAccount) {
        let bridge = signer.borrow<&NativeEVMBridge.BridgeResource>(from: /storage/EVMBridge)
        bridge.schedulePayment(recipient: recipient, amount: amount, delaySeconds: delaySeconds, evmTxHash: evmTxHash)
    }
}`;
```

### 💱 DeFi Protocol Integration

**Price Trigger System** ([`src/services/price-monitor.ts`](src/services/price-monitor.ts))

```typescript
// Real-time monitoring service that watches asset prices and executes conditional alerts
async createPriceTrigger(trigger: Omit<PriceTrigger, "id" | "createdAt" | "status">): Promise<{
    success: boolean;
    triggerId?: string;
    error?: string;
}> {
    // Implementation for price-based triggers
}
```

**Token Resolution** ([`src/services/token-service.ts`](src/services/token-service.ts))

-   Supports ENS (.eth), RNS (.rsk), and direct wallet addresses
-   Automatic name service resolution

**Transfer & Payment Engine** ([`src/services/transaction-executor.ts`](src/services/transaction-executor.ts))

```typescript
// Native token transfers across multiple chains with automatic recipient resolution
private async executeTransaction(
    wallet: any,
    walletChain: any,
    transaction: { to: string; value: string; data: string }
): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    // Multi-chain transaction execution logic
}
```

### 📅 Calendar-Native Experience

**Google Calendar API** ([`src/api/calendar.ts`](src/api/calendar.ts))

```typescript
// Deep integration with Google Calendar for event creation, modification, and real-time webhook notifications
router.post("/webhook", async (req: Request, res: Response) => {
	const resourceState = headers["x-goog-resource-state"] as string;
	if (resourceState === "update") {
		await handleCalendarUpdate(resourceId);
	}
});
```

**Natural Language Processing** ([`src/services/gemini-service.ts`](src/services/gemini-service.ts))

```typescript
// Events like "Split dinner $200 with @alice @bob tomorrow 7pm" automatically parsed and scheduled
private buildParsingPrompt(userText: string, scheduledTime?: Date): string {
    return `Parse this calendar event for DeFi actions: "${userText}"
    Extract: intent, action, amount, recipient, token, chain, scheduled time
    Support patterns: transfers, swaps, staking, price alerts, recurring payments`;
}
```

## 🔧 API Endpoints

### Wallet Management

**Onboard User**

```http
POST /api/wallet/onboard
Content-Type: application/json

{
  "email": "user@example.com",
  "privyWalletAddress": "0x1234...",
  "chainIds": [545, 31, 11155111]
}
```

**Execute Transaction**

```http
POST /api/wallet/execute
Content-Type: application/json

{
  "userId": "user-id",
  "chainId": 545,
  "transactions": [{
    "to": "0x1234...",
    "value": "1000000000000000000",
    "data": "0x"
  }]
}
```

### Flow Scheduler

**Schedule Payment**

```http
POST /api/flow-scheduler/schedule
Content-Type: application/json

{
  "recipient": "0x1234...",
  "amount": "10.0",
  "delaySeconds": 3600,
  "userId": "user-id",
  "method": "evm"
}
```

### Price Triggers

**Create Price Alert**

```http
POST /api/price-triggers/create
Content-Type: application/json

{
  "userId": "user-id",
  "token": "ETH",
  "condition": "above",
  "targetPrice": 3000,
  "action": "alert"
}
```

### Calendar Integration

**Get AI Events**

```http
GET /api/calendar/events/ai?userId=user-id
```

## 🔒 Security & Access Control

**Privy Authentication** ([`src/services/wallet/privy-service.ts`](src/services/wallet/privy-service.ts))

-   Seamless wallet onboarding with email-based authentication
-   Automatic wallet generation

**Encrypted Storage** ([`src/utils/encryption.ts`](src/utils/encryption.ts))

-   Agent wallet private keys encrypted at rest with secure key derivation
-   In-memory caching for performance

**Rate Limiting** ([`src/api/wallet.ts`](src/api/wallet.ts))

```typescript
// API endpoints protected with intelligent rate limiting
const walletCreationLimit = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 1, // 1 wallet creation per user per 15 minutes
});

const walletOperationLimit = rateLimit({
	windowMs: 1 * 60 * 1000, // 1 minute
	max: 10, // 10 operations per minute
});
```

**Revocation System** ([`src/api/wallet.ts`](src/api/wallet.ts))

```typescript
// Users can instantly revoke agent access
router.post("/revoke", async (req, res) => {
	// Remove agent wallet from Safe signers and disable automation
});
```

## 🏃‍♂️ Quick Start

### Prerequisites

-   Node.js 18+
-   PostgreSQL database
-   Google Calendar API credentials
-   Gemini AI API key
-   Polygon.io API key (optional)

### Environment Setup

```bash
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/calendyfi"

# Google Calendar & AI
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
GEMINI_API_KEY="your-gemini-api-key"

# Blockchain Networks
FLOW_EVM_RPC_URL="https://testnet.evm.nodes.onflow.org"
FLOW_EVM_DEPLOYER_PRIVATE_KEY="your-deployer-key"
ROOTSTOCK_RPC_URL="https://public-node.testnet.rsk.co"
ROOTSTOCK_DEPLOYER_PRIVATE_KEY="your-deployer-key"
SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/your-key"
SEPOLIA_DEPLOYER_PRIVATE_KEY="your-deployer-key"

# Price Feeds
POLYGON_API_KEY="your-polygon-api-key"
```

### Installation & Run

```bash
# Install dependencies
npm install

# Setup database
npx prisma generate
npx prisma db push

# Start development server
npm run dev
```

### Test Scripts

```bash
# Test Flow EVM integration
npm run test:flow-scheduler

# Test price monitoring
npm run test:price-triggers

# Test real-time data feeds
npm run test:realtime-data

# Test multi-chain deployment
npm run test:evm-scheduler
```

## 🛠️ Technical Highlights

-   **Multi-Signature Security**: Safe SDK implementation with user + agent co-signing
-   **EIP-712 Compliance**: Proper typed data signing for transaction security
-   **Chain Abstraction**: Unified API supporting multiple EVM chains with chain-specific optimizations
-   **Real-Time Processing**: Event-driven architecture with webhook integration and immediate execution
-   **Production Scale**: Rate limiting, error handling, retry mechanisms, and comprehensive logging

## 📊 Sponsors' Tech Usage

### Flow

-   **Core execution layer** with Flow EVM testnet integration
-   **Native FLOW token support** and Flow-specific smart contract deployment
-   **Calendar-triggered transactions** with EVM-to-Cadence bridge communication

### Rootstock (RSK)

-   **Bitcoin-secured smart wallet deployment** with Safe Protocol Kit
-   **RBTC native token handling** and RNS domain resolution
-   **Bitcoin DeFi automation** through calendar scheduling

### Google Calendar API + Gemini AI

-   **Calendar event parsing** with AI-powered natural language understanding
-   **Webhook-based real-time synchronization** and intelligent DeFi command extraction
-   **Advanced pattern recognition** for 50+ DeFi operations

### Privy

-   **Streamlined wallet onboarding** with email authentication
-   **Automatic wallet generation** and secure key management
-   **Dual-wallet architecture** for both user and agent wallets

## 📁 Project Structure

```
src/
├── api/                    # REST API endpoints
│   ├── auth.ts            # Authentication & user management
│   ├── calendar.ts        # Google Calendar integration
│   ├── wallet.ts          # Wallet management & transactions
│   ├── flow-scheduler.ts  # Flow blockchain scheduling
│   ├── evm-bridge.ts      # EVM bridge operations
│   └── price-triggers.ts  # Price monitoring & alerts
├── services/              # Core business logic
│   ├── gemini-service.ts  # AI event parsing
│   ├── price-monitor.ts   # Real-time price monitoring
│   ├── transaction-executor.ts # Multi-chain execution
│   ├── evm-bridge.ts      # Flow EVM bridge service
│   └── wallet/            # Wallet management services
├── utils/                 # Utility functions
│   ├── encryption.ts      # Key encryption/decryption
│   ├── schedule-parser.ts # Time parsing utilities
│   └── token-service.ts   # Token resolution
└── scripts/               # Test & utility scripts
    ├── test-flow-scheduler.ts
    ├── test-price-triggers.ts
    └── test-realtime-data.ts
```

## 🎯 Key Features Implemented

✅ **AI-Powered Calendar Parsing** - Gemini AI integration for natural language DeFi commands  
✅ **Multi-Chain Wallet Management** - Safe Protocol Kit + Custom Smart Accounts  
✅ **Real-Time Price Monitoring** - Polygon.io + CoinGecko integration  
✅ **Flow EVM Bridge** - Cross-VM communication between EVM and Cadence  
✅ **Automated Transaction Execution** - Agent wallets with EIP-712 signing  
✅ **Google Calendar Integration** - Webhook-based real-time synchronization  
✅ **Multi-Signature Security** - 1-of-2 threshold with user + agent co-signing  
✅ **Rate Limiting & Security** - Production-ready API protection  
✅ **Database Integration** - Prisma ORM with PostgreSQL  
✅ **Comprehensive Logging** - Structured logging and error handling

---

**CalendeFi** - Where your calendar becomes your DeFi command center. Schedule the future of finance. ⏰💸
