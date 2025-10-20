# Backend API Reference (Stable)

Auth: All endpoints (unless noted) require `Authorization: Bearer <JWT>` with Privy-issued token or internal token where specified.

## Health
- `GET /health` → `{ ok: true }`
- `GET /health/readiness` → env/CORS/rate-limit snapshot
- `GET /health/liveness` → DB and queue status

## Auth
- `POST /auth/login` { privyDid, email, walletAddress? } → returns app JWT
- `GET /auth/profile` → current user object

## Portfolio
- `GET /portfolio` → aggregated balances (cached)
- `POST /portfolio/fund-suggestion` { targetChain, stableSymbol?, stableMin?, nativeGasMin? }

## Transactions
- `POST /transaction/quote` { intent } → OneBalance/Sei quote with `transactionRequest`
- `POST /transaction/quote/providers` { intent } → compare OneBalance vs Li.Fi (best-effort)
- `POST /transaction/execute` { sessionKeyId, intent, idempotencyKey? } → enqueues job
  - Optional header `Idempotency-Key` supported
- `GET /transaction/logs?limit=` → latest logs for user
- `GET /transaction/chains` → supported chains & readiness
- `GET /transaction/bridge/config` → Axelar env diagnostics
- `POST /transaction/execute/internal` (Service-to-service)
  - Guard: `x-service-token: <INTERNAL_API_TOKEN>`
  - Body: { userId, sessionKeyId, intent, idempotencyKey? }

Intent shape: see `packages/database/src/types/transaction-job.ts` (`TransactionIntent`).

## Automations
- `POST /automations` { CreateStrategyDto }
- `GET /automations` → list
- `GET /automations/:id`
- `PATCH /automations/:id` { UpdateStrategyDto }
- `DELETE /automations/:id`

## Session Keys
- `POST /session-keys` { CreateSessionKeyDto }
- `GET /session-keys`
- `PATCH /session-keys/:id` { UpdateSessionKeyDto }

## Smart Account
- `POST /smart-account/deploy` { chain, sessionKeyId }
- `GET /smart-account/status?chain=`

## Onboarding
- `GET /onboarding/addresses`
- `GET /onboarding/status?chain=`
- `GET /onboarding/recommendation?preferred=`
- `POST /onboarding/prepare/native-transfer` { chain, to, valueWei }
- `POST /onboarding/prepare/erc20-transfer` { chain, token, to, amount }
- `POST /onboarding/fund-plan` { targetChain, safeAddress, fromChain, fromToken, fromAmount, toToken? }
- `POST /onboarding/fund-quote` { ...same as plan } → select provider & executable tx

## Chat
- `POST /chat` { input, chatHistory? } → agent response, with tools

## Throttle limits (defaults)
- `/transaction/quote`: 60/min
- `/transaction/quote/providers`: 30/min
- `/transaction/execute`: 10/min
- `/auth/login`: 15/min
- `/chat`: 30/min

Errors are returned in a structured form: `{ ok: false, status, requestId, error, details? }`.

