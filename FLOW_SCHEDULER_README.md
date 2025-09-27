# Flow Scheduler Integration

A complete EVM-to-Cadence scheduling system integrated with the CalendyFi AI calendar agent.

## 🚀 Overview

This integration adds Flow blockchain scheduling capabilities to the existing calendar AI system, enabling:

-   **EVM Contract Integration**: Schedule payments via Flow EVM contracts
-   **Cadence Contract Integration**: Direct interaction with Flow Cadence smart contracts
-   **Cross-VM Communication**: Seamless bridging between EVM and Cadence
-   **AI Event Processing**: Automatic scheduling from calendar AI events
-   **Frontend Ready**: Complete API endpoints for frontend integration

## 📋 Contract Addresses (Testnet)

-   **EVM Scheduler**: `0x6baaD070bF8AB1932578157826CfB209BdB254a1`
-   **Cadence Scheduler**: `0x9f3e9372a21a4f15`
-   **Flow Token**: `0x7e60df042a9c0868`
-   **Fungible Token**: `0x9a0766d93b6608b7`

## 🏗️ Architecture

### Core Components

1. **FlowSchedulerService** (`src/services/flow-scheduler.ts`)

    - EVM contract integration
    - Cadence contract interaction
    - Cross-chain payment scheduling
    - Payment execution and monitoring

2. **Flow Scheduler API** (`src/api/flow-scheduler.ts`)

    - RESTful endpoints for scheduling
    - Payment management
    - Status monitoring
    - Calendar event integration

3. **Database Integration** (`src/prisma/schema.prisma`)

    - FlowScheduledPayment model
    - Calendar event linking
    - Transaction tracking

4. **Scheduler Integration** (`src/services/scheduler.ts`)
    - Automatic payment processing
    - Background execution
    - Error handling and retry logic

## 🔧 API Endpoints

### Schedule Payment

```http
POST /api/flow-scheduler/schedule
Content-Type: application/json

{
  "recipient": "0x1234...",
  "amount": "10.0",
  "delaySeconds": 3600,
  "userId": "user-id",
  "method": "evm" // or "cadence"
}
```

### Get Scheduled Payments

```http
GET /api/flow-scheduler/payments?userId=user-id&executed=false
```

### Execute Payment

```http
POST /api/flow-scheduler/execute
Content-Type: application/json

{
  "paymentId": "schedule-id"
}
```

### Schedule from Calendar Event

```http
POST /api/flow-scheduler/schedule-from-event
Content-Type: application/json

{
  "eventId": "calendar-event-id"
}
```

### Process AI Event with Flow Scheduling

```http
POST /api/calendar/process-ai-event
Content-Type: application/json

{
  "eventId": "calendar-event-id",
  "scheduleOnFlow": true
}
```

## 💾 Database Schema

### FlowScheduledPayment Model

```prisma
model FlowScheduledPayment {
  id            String    @id @default(cuid())
  scheduleId    String    @unique
  userId        String
  recipient     String
  amount        String
  delaySeconds  Int
  scheduledTime DateTime
  method        String    @default("evm")
  evmTxHash     String?
  cadenceTxId   String?
  eventId       String?
  description   String?
  executed      Boolean   @default(false)
  executedAt    DateTime?
  executionTxId String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  user          User      @relation(fields: [userId], references: [id])
}
```

### Calendar Event Extensions

```prisma
// Added to CalendarEvent model
flowScheduleId      String?
flowEvmTxHash       String?
flowCadenceTxId     String?
```

## 🔗 Frontend Integration

The system is fully compatible with the provided frontend example (`ex/PaymentScheduler.jsx`):

### React Component Usage

```jsx
import { ethers } from "ethers";
import * as fcl from "@onflow/fcl";

// Initialize contracts
const provider = new ethers.providers.Web3Provider(window.ethereum);
const evmScheduler = new ethers.Contract(
	"0x6baaD070bF8AB1932578157826CfB209BdB254a1",
	EVM_SCHEDULER_ABI,
	provider.getSigner()
);

// Schedule payment
const tx = await evmScheduler.schedulePayment(recipient, amount, delaySeconds);
const receipt = await tx.wait();
```

### Flow/Cadence Integration

```javascript
// Configure FCL
fcl.config({
	"accessNode.api": "https://rest-testnet.onflow.org",
	"discovery.wallet": "https://fcl-discovery.onflow.org/testnet/authn",
});

// Schedule payment via Cadence
const txId = await fcl.mutate({
	cadence: schedulePaymentTransaction,
	args: [
		fcl.arg(recipient, t.String),
		fcl.arg(amount, t.UFix64),
		fcl.arg(delaySeconds, t.UFix64),
	],
});
```

## 🔧 Configuration

### Environment Variables

```bash
# Flow EVM Configuration
FLOW_EVM_RPC_URL=https://testnet.evm.nodes.onflow.org
FLOW_EVM_DEPLOYER_PRIVATE_KEY=your_private_key

# Flow Cadence Configuration
FLOW_CADENCE_ACCESS_NODE=https://rest-testnet.onflow.org
FLOW_CADENCE_PRIVATE_KEY=your_flow_private_key

# Optional: Enable test scheduling
TEST_FLOW_SCHEDULING=true
```

### Chain Configuration

The system automatically configures Flow chains:

-   **Flow EVM Testnet**: Chain ID 545
-   **Flow Cadence Testnet**: Chain ID 646

## 🧪 Testing

### Run Flow Scheduler Tests

```bash
npm run test:flow
```

### Manual Testing

1. **Schedule a payment**:

    ```bash
    curl -X POST http://localhost:3000/api/flow-scheduler/schedule \
      -H "Content-Type: application/json" \
      -d '{
        "recipient": "0x1234567890123456789012345678901234567890",
        "amount": "1.0",
        "delaySeconds": 60,
        "userId": "test-user",
        "method": "evm"
      }'
    ```

2. **Check scheduled payments**:

    ```bash
    curl http://localhost:3000/api/flow-scheduler/payments
    ```

3. **Process ready payments**:
    ```bash
    curl -X POST http://localhost:3000/api/flow-scheduler/process-ready
    ```

## 🔄 Workflow

### AI Calendar Event → Flow Payment

1. **AI Detection**: Calendar event parsed by AI
2. **Payment Extraction**: Amount, recipient, timing extracted
3. **Flow Scheduling**: Payment scheduled on Flow blockchain
4. **Database Storage**: Schedule stored locally for tracking
5. **Automatic Execution**: Background processor executes when ready

### Manual Scheduling

1. **API Request**: Frontend sends scheduling request
2. **Contract Interaction**: EVM or Cadence contract called
3. **Transaction Confirmation**: Blockchain confirmation received
4. **Status Tracking**: Payment status monitored
5. **Execution**: Automatic execution at scheduled time

## 🚨 Error Handling

### Common Issues

1. **Contract Not Found**: Check contract addresses
2. **Insufficient Funds**: Ensure wallet has FLOW tokens
3. **Network Issues**: Verify RPC endpoints
4. **Invalid Recipients**: Validate addresses

### Debugging

```bash
# Enable debug logging
DEBUG=flow-scheduler npm run dev

# Check scheduler status
curl http://localhost:3000/api/flow-scheduler/status
```

## 🔐 Security Considerations

-   **Private Keys**: Securely store deployer private keys
-   **Input Validation**: All inputs validated and sanitized
-   **Rate Limiting**: API endpoints protected with rate limits
-   **Access Control**: User-based payment isolation
-   **Transaction Safety**: Payments verified before execution

## 📈 Monitoring

### Scheduler Status

The system provides comprehensive monitoring:

-   **Processed Payments**: Count of executed payments
-   **Failed Executions**: Error tracking and logging
-   **Performance Metrics**: Execution times and success rates
-   **Chain Status**: EVM and Cadence connectivity

### Logging

```typescript
// Comprehensive logging throughout
console.info("Payment scheduled", { scheduleId, amount, recipient });
console.warn("Execution delayed", { paymentId, timeRemaining });
console.error("Payment failed", { error, paymentId });
```

## 🚀 Production Deployment

### Prerequisites

1. **Database Migration**: Run `npm run db:migrate`
2. **Environment Setup**: Configure all required environment variables
3. **Contract Deployment**: Deploy contracts to mainnet
4. **Wallet Funding**: Ensure deployer wallets have sufficient funds

### Deployment Steps

```bash
# 1. Build the application
npm run build

# 2. Run database migrations
npm run db:migrate

# 3. Start the server
npm start
```

## 🤝 Integration Examples

### With Existing Wallet System

```typescript
// Integrate with existing wallet service
const walletService = createWalletService();
const flowScheduler = createFlowSchedulerService();

// Schedule payment using user's wallet
const result = await flowScheduler.schedulePaymentViaEVM({
	recipient: userWallet.address,
	amount: "5.0",
	delaySeconds: 3600,
	userId: user.id,
});
```

### With Calendar Events

```typescript
// Automatic scheduling from calendar events
const event = await getCalendarEvent(eventId);
if (event.isAiEvent && event.parsedAction === "pay") {
	await scheduleFromCalendarEvent(event);
}
```

## 📚 Additional Resources

-   [Flow Documentation](https://developers.flow.com/)
-   [Flow EVM Documentation](https://developers.flow.com/evm)
-   [FCL Documentation](https://developers.flow.com/tools/fcl-js)
-   [Cadence Language](https://developers.flow.com/cadence)

## 🎉 Ready to Use!

The Flow Scheduler integration is now fully implemented and ready for use. The system provides:

-   ✅ **Complete EVM integration** with Solidity contracts
-   ✅ **Full Flow/Cadence support** with FCL
-   ✅ **Backend API endpoints** for all operations
-   ✅ **Database integration** for persistence
-   ✅ **Frontend compatibility** with provided examples
-   ✅ **Automatic scheduling** from AI calendar events
-   ✅ **Production-ready** error handling and monitoring

**Start scheduling payments on Flow today! 🚀**
