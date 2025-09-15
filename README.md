# Copil - AI-Powered DeFi Automation Platform on Sei Network

Copil is Copil'ot a next-generation DeFi automation platform specifically built for Sei Network that combines AI agents with sophisticated trading strategies. It provides seamless, secure, and intelligent DeFi automation through natural language interfaces while maintaining complete user control over assets via ERC-4337 Account Abstraction.

## Current Status: **FULLY OPERATIONAL**

- **Backend**: Fully operational API with all services running
- **Database**: PostgreSQL with complete schema and migrations  
- **AI Agents**: LangChain-powered agents for DeFi operations
- **Blockchain**: Sei Network integration with smart contracts deployed
- **Real-time**: WebSocket connections for live updates
- **Frontend**: In development (Next.js 14)

## Features

- **AI-Powered Trading**: Natural language interface for complex DeFi strategies
- **Multi-DEX Aggregation**: Best execution across Astroport, DragonSwap, White Whale, and more
- **ERC-4337 Account Abstraction**: Secure automation without exposing private keys
- **Real-time Analytics**: Advanced market analysis and portfolio insights
- **Strategy Automation**: DCA, arbitrage, yield optimization, and portfolio rebalancing
- **Institutional Security**: Session keys, multi-sig, and hardware wallet support

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Frontend Layer                         │
│  Next.js 14 App with Natural Language Interface          │
└─────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────┐
│                   API Gateway                            │
│         WebSocket + REST API (Node.js/Express)           │
└─────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────┐
│              AI Agent Orchestration Layer                │
│     Orchestrator Agent + Specialized DeFi Agents         │
└─────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────┐
│              Blockchain Abstraction Layer                │
│    ERC-4337 Account Abstraction + Session Keys           │
└─────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────┐
│                    Sei Network                           │
│         Parallel EVM + DeFi Protocols                    │
└─────────────────────────────────────────────────────────┘
```

## Tech Stack

### Backend
- **Runtime**: Node.js 18+ with TypeScript
- **Framework**: Express.js with Socket.IO
- **Database**: PostgreSQL + TimescaleDB + Redis + ClickHouse + Neo4j
- **Blockchain**: Sei Network EVM with viem
- **AI**: OpenAI GPT-4 with custom agents
- **Monitoring**: Prometheus + Grafana + Jaeger
- **Messaging**: Apache Kafka

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL (running locally or via Docker)
- Redis (for caching and real-time features)
- Git

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/copilfi/copil
cd copil
```

2. **Install dependencies**
```bash
npm install
```

3. **Setup environment**
```bash
cp .env.example .env
# Edit .env with your configuration:
# - DATABASE_URL for PostgreSQL
# - REDIS_URL for Redis
# - OPENAI_API_KEY for AI agents
# - SEI_RPC_URL for blockchain interaction
```

4. **Setup database**
```bash
npm run generate --workspace=@copil/database
DATABASE_URL="your_db_url" npx prisma db push --accept-data-loss
```

5. **Start API server**
```bash
npm run dev --workspace=@copil/api
```

The API Gateway will be available at `http://localhost:3002`

### Test the API
```bash
curl -X POST http://localhost:3002/api/test-copil \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello Copil! Check my SEI balance."}'
```

## Project Structure

```
copil-sei-platform/
├── apps/
│   ├── api/                  # Main API Gateway (OPERATIONAL)
│   │   ├── src/
│   │   │   ├── controllers/  # REST API controllers
│   │   │   ├── services/     # Business logic services
│   │   │   ├── middleware/   # Auth, CORS, rate limiting
│   │   │   ├── routes/       # API route definitions
│   │   │   └── types/        # TypeScript type definitions
│   │   └── package.json
│   ├── contracts/            # Smart Contracts (DEPLOYED)
│   │   ├── src/              # Solidity contracts
│   │   ├── scripts/          # Deployment scripts
│   │   └── package.json
│   └── web/                  # Frontend (EMPTY - TO DO)
├── packages/
│   ├── ai-agent/            # AI Agent System (OPERATIONAL)
│   │   ├── src/
│   │   │   ├── agents/      # LangChain AI agents
│   │   │   ├── tools/       # DeFi trading tools
│   │   │   └── types/       # Agent interfaces
│   │   └── package.json
│   ├── database/            # Database Layer (OPERATIONAL)
│   │   ├── prisma/          # Schema & migrations
│   │   ├── src/             # Database utilities
│   │   └── package.json
│   ├── blockchain/          # Blockchain Integration (OPERATIONAL)
│   │   ├── src/             # Sei Network utilities
│   │   └── package.json
│   ├── core/                # Shared Types
│   ├── ai-models/           # ML Models (PLACEHOLDER)
│   └── utils/               # Utilities
├── infrastructure/
│   ├── docker/              # Docker configurations
│   ├── kubernetes/          # K8s deployments (PLACEHOLDER)
│   └── terraform/           # Infrastructure as Code (PLACEHOLDER)
├── docs/                    # Documentation
│   ├── api/                 # API documentation
│   ├── architecture/        # System design docs
│   └── user-guide/          # User guides
├── examples/                # Usage examples
├── .env                     # Environment configuration
├── copil-prd.md            # Product Requirements Document
└── package.json            # Root package.json (workspace config)
```

## Development

### Available Scripts

```bash
# Development (Currently Working)
npm run dev --workspace=@copil/api        # Start API server (port 3002)
npm run build --workspace=@copil/api      # Build API package
npm run build --workspace=@copil/ai-agent # Build AI agent package

# Database (Currently Working)
npm run generate --workspace=@copil/database  # Generate Prisma client
DATABASE_URL="<url>" npx prisma db push        # Push schema to database
DATABASE_URL="<url>" npx prisma studio        # Open Prisma Studio

# Smart Contracts (Deployed to Sei)
npm run compile --workspace=@copil/contracts  # Compile contracts
npm run deploy --workspace=@copil/contracts   # Deploy to Sei

# Development Tools
npm run typecheck           # Type checking across packages
npm install                 # Install all dependencies
npm run clean               # Clean build artifacts
```

### Currently Deployed Smart Contracts (Sei Mainnet)

- **Account Factory**: `0x3597342717C9545D555233b195525542B7f591c2`
- **Conditional Order Engine**: `0x425020571862cfDc97727bB6c920866D8BeAbbeB`
- **Entry Point**: `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`

### API Documentation

The API Gateway provides the following endpoints:

#### Authentication
- `POST /api/auth/challenge` - Get signing challenge
- `POST /api/auth/connect` - Connect wallet and authenticate
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/verify` - Verify token

#### Trading
- `POST /api/trading/quote` - Get swap quotes
- `POST /api/trading/swap` - Execute swap

#### Strategies  
- `GET /api/strategy` - List user strategies
- `POST /api/strategy` - Create new strategy
- `PUT /api/strategy/:id` - Update strategy
- `DELETE /api/strategy/:id` - Delete strategy

#### Portfolio
- `GET /api/portfolio` - Get portfolio summary
- `GET /api/portfolio/history` - Get transaction history

#### AI Assistant
- `POST /api/ai/chat` - Send message to AI
- `GET /api/ai/recommendations` - Get AI recommendations

#### Market Data
- `GET /api/market/prices` - Get token prices
- `GET /api/market/analytics` - Get market analysis

### WebSocket Events

Connect to WebSocket at `ws://localhost:3000` with authentication token:

```javascript
const socket = io('ws://localhost:3000', {
  auth: {
    token: 'your-jwt-token'
  }
});

// Subscribe to price updates
socket.emit('subscribe:prices', ['SEI', 'USDC', 'WETH']);

// Listen for price updates
socket.on('price:update', (data) => {
  console.log('Price update:', data);
});
```

## Security

Copil implements multiple layers of security:

- **ERC-4337 Account Abstraction**: Users never expose their private keys
- **Session Keys**: Time-bound automation keys with specific permissions
- **Multi-signature Support**: Optional 2-of-3 multi-sig for high-value operations
- **Hardware Wallet Support**: Ledger integration for secure signing
- **Rate Limiting**: API and AI endpoint protection
- **Input Validation**: Comprehensive validation with Zod schemas


## AI Agents

Copil features specialized AI agents:

- **Orchestrator Agent**
- **Trading Agent**: Executes and optimizes trades
- **Analytics Agent**: Market analysis and predictions
- **Portfolio Agent**: Portfolio optimization and rebalancing
- **Risk Agent**: Risk assessment and management

## Supported DEXes

- **Astroport**: Primary DEX integration
- **DragonSwap**: V3 concentrated liquidity
- **White Whale**: Cross-chain routing
- **Fuzio Network**: Additional liquidity sources

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

Built with love for the Sei Network ecosystem