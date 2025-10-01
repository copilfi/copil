# Phase 0 Discovery Summary

## Scope and Objectives
- Inventory existing mock data usage across backend and frontend.
- Map current Sei blockchain integrations, data providers, and rate-limit sensitivities.
- Identify AI Agent touchpoints and their tool dependencies.
- Incorporate external resources (Sei Agent Kit, ecosystem contract registry) into future integration planning.
- Define success metrics and readiness checkpoints for subsequent phases.

## Mock Data & Placeholder Inventory

| Area | File | Purpose | Notes |
| --- | --- | --- | --- |
| DEX Aggregation | `apps/api/src/services/DEXAggregationService.ts` | `calculateMockAmountOut` & `calculateMockPriceImpact` fabricate swap quotes when Symphony/route execution is unavailable. | Replace with real routing (Phase 7 prep). |
| DCA API | `apps/api/src/routes/dca.ts` | Returns hard-coded strategy lists, executions, and performance metrics. | Needs real Prisma + strategy engine wiring (Phase 2). |
| Conditional Orders API | `apps/api/src/routes/orders.ts` | Provides mock orders, status responses. | Same remediation as DCA routes. |
| Queue Service | `apps/api/src/services/QueueService.ts` | Returns placeholder swap hash. | Replace when real transaction submission queue is active. |
| Websocket Gateway | `apps/api/gateway/src/websocket/index.ts` | Emits placeholder AI responses and SEI price updates. | Tie into real event streams & market data (Phase 4/5). |
| Frontend Automation | `frontend/src/components/generated/AutomationPage.tsx` | Displays mock automation data & placeholders. | Consume real `/api/dca` & `/api/orders`. |
| Frontend Dashboard | `frontend/src/components/generated/Dashboard.tsx` | Charts rely on mocked portfolio history and AI insight placeholders. | Wire to live `/api/portfolio/*` endpoints and AI outputs. |
| Frontend Trading Page | `frontend/src/components/generated/TradingPage.tsx` | Uses static swap preview + wizard copy. | Needs actual quote + execution flow. |

Additional keywords (“placeholder”, “mock”) validated via ripgrep on repo root.

## Real Blockchain & Data Integrations (Today)
- **RealBlockchainService** (`apps/api/src/services/RealBlockchainService.ts`)
  - Uses Alchemy RPC (production) with fallback to Sei RPC; bundler active in non-prod.
  - Provides Smart Account deploy + session key management via `@copil/blockchain` services.
  - Balance queries delegate to `packages/blockchain/src/services/BalanceService.ts` with market price provider from `MarketDataService` (CoinGecko + DeFiLlama).
- **EventIndexingService**
  - Batch size capped by `EVENT_INDEX_BLOCK_RANGE` to respect Alchemy 10-block `eth_getLogs` limit.
  - Seeds pull from Prisma `indexed_contracts`; new registry data (see below) ready for ingestion.
- **Portfolio API** (`/api/portfolio/summary`, `/history`)
  - Resolves smart account address on-chain and fetches balances/price via BalanceService.
  - Still experiences redundant polling; needs caching/rate limiting to keep CU cost predictable.
- **Auth Refresh Pipeline**
  - Redis stores refresh-token families; fallback to Postgres not yet implemented.
- **AI Agent Service**
  - Initiates `DeFiAgent` with `SeiProvider`, `DexExecutor`, `ConditionalOrderEngineContract`, `TokenResolver` from `@copil` packages.
  - Tools defined in `@copil/ai-agent` currently expect fully functional DEX/order services—mock data breaks end-to-end execution.

## External Resources to Leverage
- **Sei Agent Kit** (`sei-agent-kit/`)
  - Symphony swap implementation (`src/tools/symphony/swap.ts`) for reference when replacing DEX mock quotes.
  - DexScreener ticker→address resolver (`src/tools/dexscreener`) for token discovery and asset list updates.
  - Carbon strategy utilities for advanced automation scenarios (potential Phase 2+ enhancements).
- **Ecosystem Contract Registry** (`ecosystemcontracts.md`)
  - DragonSwap, Silo, Stargate, YEI, Carbon, oku.trade contract addresses ready for seeding event indexer, token metadata, and DEX adapters.

## Success Metrics & Telemetry Baseline
- Portfolio endpoints: < 1.5s p95 latency, < 5% error rate, Alchemy CU per request tracked.
- Strategy engine: 0 unknown-condition warnings per cron cycle, successful execution logs on triggered strategies.
- Auth refresh: 0 stale refresh token re-use (Redis blacklist hits) and < 200ms median response.
- Event indexer: sustained operation without `eth_getLogs` range errors; backlog < 2 batches.
- Frontend: Vite build passes, Lighthouse performance ≥ 80, no mock data on dashboard/automation/trading views.

## Entry Criteria for Phase 1
- Discovery findings documented (this file) and shared.
- Mock inventory acknowledged and prioritized in roadmap.
- External resources mapped to upcoming implementation tasks.
- Success metrics agreed upon as acceptance criteria for subsequent phases.

