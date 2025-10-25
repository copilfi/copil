# Copil — Local Setup Quickstart

This guide brings the stack up locally for development/testing.

## Prerequisites
- Node 18+
- PostgreSQL 14+
- Redis 6+

## 1) Environment
Copy `.env.example` to the corresponding services and fill the values:

- Core
  - Database: `DB_*`
  - Redis: `REDIS_*`
  - Web origin: `WEB_ORIGIN`
- Quotes / balances: `ONEBALANCE_API_KEY`
- LLM (choose one)
  - OpenAI: `OPENAI_API_KEY` (optional `OPENAI_MODEL`)
  - Groq: `GROQ_API_KEY` (optional `GROQ_MODEL`) and optionally `LLM_PROVIDER=groq`
- RPC URLs (at least one): `RPC_URL_<CHAIN>`
- Pimlico (executor): `PIMLICO_API_KEY` (and optionally `PAYMASTER_ENABLED` + `PIMLICO_PAYMASTER_API_KEY`)
- Strategy Evaluator → API: `INTERNAL_API_TOKEN`, `API_SERVICE_URL`
- Session keys: `SESSION_KEY_<id>_PRIVATE_KEY` (EVM), `SESSION_KEY_<id>_PRIVATE_KEY_BYTES` or `_B58` (Solana)

## 2) Database & Migrations
Create the database and run API migrations:

```
cd apps/api
npm run migration:run
```

## 3) Services

In separate terminals:

```
# API
cd apps/api && npm run start:dev

# Transaction Executor
cd apps/transaction-executor && npm run start:dev

# Strategy Evaluator
cd apps/strategy-evaluator && npm run start:dev

# Data Ingestor
cd apps/data-ingestor && npm run start:dev

# Web (Next.js)
cd web && npm run dev
```

## 4) Verify
- API readiness: `GET /health/readiness` (keys, rpc, llm)
- Executor health/metrics: `http://localhost:${TX_EXECUTOR_PORT}/health`, `/metrics/*`
- Web dashboard: http://localhost:3000

## 5) First Run Tips
- Log in from `/login` (or manual form) → API `/auth/login` will create user and wallets.
- Add a session key from “Session Keys” and configure allowed contracts/spend limits.
- Try a simple EVM swap via chat; confirm with `sessionKeyId`.
- Strategy → create price or trend trigger; use “Diagnose” to understand non-trigger states.

## Notes
- Smart Accounts (Safe) are auto-deployed with the first UserOperation, no explicit deploy is required.
- Solana swaps use Jupiter and require a Solana session key bytes/B58.
- Hyperliquid uses the session key account as the trading identity.

