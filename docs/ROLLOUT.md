# Rollout Checklist (Backend Services)

This checklist ensures a safe rollout across API, Executor, Evaluator, and Data Ingestor.

## 0) Shared
- DB: `DB_*` present and reachable
- Redis: `REDIS_HOST`, `REDIS_PORT` present
- INTERNAL API token alignment: set the same `INTERNAL_API_TOKEN` in API and Evaluator

## 1) API (apps/api)
- Required: `ONEBALANCE_API_KEY`
- RPC URLs: `RPC_URL_<CHAIN>` for executing chains (ethereum, base, arbitrum, ...)
- Chat (optional): `CHAT_ENABLED=true` + (`OPENAI_API_KEY` or `GROQ_API_KEY`)
- Solana prepared swap (optional): `JUPITER_API_URL` (default OK)
- Verify: `GET /health/readiness` and `GET /health/liveness`

## 2) Transaction Executor (apps/transaction-executor)
- Required: `ONEBALANCE_API_KEY`, `PIMLICO_API_KEY`, `SESSION_KEY_<ID>_PRIVATE_KEY`
- RPC URLs per executing chain: `RPC_URL_<CHAIN>`
- Hyperliquid tuning (optional): `HL_*` (slippage/micro-buffer/chunk/aliases/agent/builder)
- Verify: `GET /health`, `GET /health/readiness`, `GET /metrics/hyperliquid`

## 3) Strategy Evaluator (apps/strategy-evaluator)
- Required: `API_SERVICE_URL`, `INTERNAL_API_TOKEN`
- Tuning: `EVALUATOR_EXECUTE_MAX_RETRIES`, `EVALUATOR_EXECUTE_BACKOFF_MS`
- Verify: `GET /health`, `GET /health/readiness`

## 4) Data Ingestor (apps/data-ingestor)
- DexScreener: `DEX_SCREENER_API_URL` (default OK), `INGEST_CHAINS`
- Hyperliquid mids: `HL_INGEST_ENABLED`, `HL_INGEST_SYMBOLS`
- Solana prices: `SOL_INGEST_ENABLED`, `SOL_INGEST_MINTS`, `JUPITER_PRICE_API_URL`
- Verify app logs for saved price counts

## 5) Smoke Flows
- EVM: Price trigger => swap/bridge job creation and success
- Hyperliquid: Price trigger => open/close job success; `GET /metrics/hyperliquid` shows counters
- Solana: prepared swap => signed+sent via executor

## 6) Gradual Enablement
- Start with Chat disabled; validate EVM + Sei; enable Hyperliquid; finally enable Chat and Solana prepared swaps.
- Rates: confirm throttles `/transaction/quote` `60/min`, `/chat` `30/min`.

## 7) Observability
- Trace ids and error filter in API; queue counts in health endpoints
- Executor metrics endpoint for Hyperliquid
