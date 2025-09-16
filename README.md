# Copil - DeFi Automation Platform on Sei Network

A DeFi automation platform built for Sei Network that enables secure wallet management and trading through smart account abstraction.

## Overview

Copil is Copil'ot provides a user-friendly interface for DeFi operations on Sei Network using ERC-4337 account abstraction. Users can manage portfolios, execute trades, and set up automated strategies while maintaining full control of their assets.

## Features

- **Smart Account Integration**: ERC-4337 account abstraction for enhanced security
- **Portfolio Management**: Real-time portfolio tracking and analytics
- **Multi-DEX Trading**: Integration with DragonSwap, White Whale, and other Sei DEXes
- **Session Keys**: Secure automation without exposing private keys
- **Real-time Updates**: WebSocket-powered live data feeds

## Tech Stack

**Backend:**
- Node.js + TypeScript + Express.js
- PostgreSQL + Prisma ORM
- Redis for caching
- WebSocket for real-time updates

**Frontend:**
- React + TypeScript + Vite
- TailwindCSS for styling
- Wallet integration (MetaMask, etc.)

**Blockchain:**
- Sei Network EVM
- ERC-4337 Smart Accounts
- Smart contract integrations

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Redis server

### Installation

1. **Clone the repository:**
```bash
git clone https://github.com/copilfi/copil
cd copil
```

2. **Install dependencies:**
```bash
npm install
```

3. **Setup environment:**
```bash
cp .env.example .env
# Configure your database and API keys in .env
```

4. **Setup database:**
```bash
npm run generate --workspace=@copil/database
DATABASE_URL="your_postgresql_url" npx prisma db push
```

5. **Start the services:**

Backend API:
```bash
CORS_ORIGIN="http://localhost:5173" PORT=8888 npm run dev --workspace=@copil/api
```

Frontend:
```bash
cd frontend && npm run dev
```

### Access the Application

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:8888
- **API Health Check**: http://localhost:8888/api/health

## Project Structure

```
copil-sei/
├── apps/
│   └── api/                 # Backend API server
├── packages/
│   ├── blockchain/          # Blockchain integration
│   └── database/           # Database schema & migrations
├── .env                   # Environment configuration
└── package.json          # Workspace configuration
```

## API Endpoints

### Authentication
- `POST /api/auth/generate-message` - Generate signing message
- `POST /api/auth/login` - Login with wallet signature
- `POST /api/auth/register` - Register new user
- `GET /api/auth/profile` - Get user profile

### Portfolio
- `GET /api/portfolio/summary` - Portfolio overview
- `GET /api/portfolio/history` - Portfolio history

### Smart Accounts
- `POST /api/smart-account/deploy` - Deploy smart account
- `GET /api/smart-account/status` - Get deployment status

## Development

### Available Scripts

```bash
# Start API server (development)
npm run dev --workspace=@copil/api

# Start frontend (development)
cd frontend && npm run dev

# Database operations
npm run generate --workspace=@copil/database
npx prisma studio

# Build for production
npm run build --workspace=@copil/api
cd frontend && npm run build
```

### Environment Variables

Required environment variables in `.env`:

```bash
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/copil_db"

# Redis
REDIS_URL="redis://localhost:6379"

# Blockchain
SEI_RPC_URL="https://evm-rpc.sei-apis.com"
PRIVATE_KEY="your_private_key"

# JWT
JWT_SECRET="your_jwt_secret"

# API Keys (optional)
OPENAI_API_KEY="your_openai_key"
ALCHEMY_API_KEY="your_alchemy_key"
```

## Support

For questions or support, please open an issue in the repository.