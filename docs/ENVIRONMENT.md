# Environment Configuration (Backend)

This document lists required and optional env vars per service. Services fail fast when critical variables are missing.

## Common (API, Evaluator, Executor, Data Ingestor)
- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` (required)
- `REDIS_HOST`, `REDIS_PORT` (required for API/Evaluator/Executor)

## API (apps/api)
- `JWT_SECRET` (required unless Privy is configured)
- `PRIVY_APP_ID` and either `PRIVY_PUBLIC_KEY_PEM` or `PRIVY_JWKS_ENDPOINT` (required if `JWT_SECRET` is not provided)
- `ONEBALANCE_API_KEY` (required)
- `WEB_ORIGIN` (comma-separated CORS allowlist; default: `http://localhost:3000`)
- `RATE_LIMIT_TTL`, `RATE_LIMIT_LIMIT` (optional; Throttler)
- `QUOTE_CACHE_TTL_MS` (optional; default: `15000`)
- `ONEBALANCE_TIMEOUT_MS` (optional; default: `10000`)
- `LIFI_TIMEOUT_MS` (optional; default: `8000`)
- `TX_MAX_ACTIVE_JOBS_PER_USER` (optional; default: `3`)
- `PORTFOLIO_CACHE_TTL_MS` (optional; default: `15000`)
- `INTERNAL_API_TOKEN` (optional; used by Strategy Evaluator for `/transaction/execute/internal`)
- `CHAT_ENABLED` (optional; default: `false`). When `true`, one of `OPENAI_API_KEY` or `GROQ_API_KEY` must be set.
- `OPENAI_API_KEY` or `GROQ_API_KEY` (required only when `CHAT_ENABLED=true`).
- `RPC_URL_<CHAIN>` (recommended; used by smart-account utilities and readiness reporting)
 - `JUPITER_API_URL` (optional; default: `https://quote-api.jup.ag`) — Solana prepared swap API base.

### Sei Bridge (Axelar)
- `SEI_BRIDGE_ENABLED=true` (enable bridge path)
- `AXELAR_GATEWAY_ADDRESS_<CHAIN>` (e.g., ETHEREUM, BASE, ARBITRUM, LINEA; at least one required)
- `AXELAR_SEI_CHAIN_NAME` (default: `sei`)
- `AXELAR_TOKEN_SYMBOL_USDC` (default: `aUSDC`)

## Transaction Executor (apps/transaction-executor)
- `ONEBALANCE_API_KEY` (required)
- `PIMLICO_API_KEY` (required for 4337 bundling)
- `PAYMASTER_ENABLED` (optional; default: `false`)
- `PIMLICO_PAYMASTER_API_KEY` (optional; falls back to `PIMLICO_API_KEY`)
- `SESSION_KEY_<ID>_PRIVATE_KEY` or `SESSION_KEY_PRIVATE_KEY` (required for signing)
- `RPC_URL_<CHAIN>` (required per executing chain)

### Hyperliquid (Perpetuals)
- Uses Hyperliquid HTTP API for trading; no on-chain RPC is required to place orders.
- Ensure a session key private key is set for the executing user (`SESSION_KEY_<ID>_PRIVATE_KEY`).
- RPC `RPC_URL_HYPERLIQUID` is only needed if you later sign raw EVM txs on Hyperliquid’s Hyperevm; current flow uses the exchange API directly.

Optional convenience (approvals/fees):
- `HL_AGENT_ADDRESS` and `HL_AGENT_NAME` — Approve agent to sign on behalf of the master account.
- `HL_BUILDER_ADDRESS` and `HL_MAX_FEE_RATE` — Approve builder fee rate once (e.g., `0.01%`).
Tuning:
- `HL_DEFAULT_SLIPPAGE` (decimal; default `0.003`) — IOC limit price buffer around mid.
- `HL_MICRO_BUFFER_MIN_BPS` (default `5`) and `HL_MICRO_BUFFER_MAX_BPS` (default `20`) — bounds for dynamic micro‑buffer from L2 spread.
- `HL_SPREAD_MULTIPLIER` (default `0.5`) — multiply L2 spread to derive micro‑buffer.
- `HL_LEVERAGE_MODE` (`cross` | `isolated`, default `cross`) — leverage mode for `updateLeverage`.
- `HL_MARKET_ALIASES` — JSON map for symbol aliases (e.g., `{"eth-perp":"ETH"}`).
- `HL_SPREAD_TO_SLIPPAGE_MULT` (default `1`) — converts L2 spread to additional slippage when no explicit slippage is provided.
- `HL_SLIPPAGE_MIN_BPS` / `HL_SLIPPAGE_MAX_BPS` — bounds for adaptive slippage.

Chunking/TWAP (optional):
- `HL_CHUNK_ENABLED` (default `false`) — enable simple chunked orders.
- `HL_CHUNK_MAX_ORDERS` (default `3`) — max number of chunks.
- `HL_CHUNK_TARGET_USD` (default `0`) — target USD per chunk (overrides `HL_CHUNK_MAX_ORDERS` if > 0).
- `HL_CHUNK_SLEEP_MS` (default `100`) — delay between chunks (ms).
- `HL_CHUNK_REFRESH_L2` (default `true`) — refresh mid/L2 top-of-book before each chunk to adapt price in volatile markets.

Session key policy extensions (optional):
- `permissions.hlAllowedMarkets`: array of allowed symbols (e.g., `["ETH","BTC"]`).
- `permissions.hlMaxUsdPerTrade`: number cap for `open_position.size`.

## Strategy Evaluator (apps/strategy-evaluator)
- `API_SERVICE_URL` (default: `http://localhost:4311`)
- `INTERNAL_API_TOKEN` (required; must match API for `/transaction/execute/internal`)
- `EVALUATOR_EXECUTE_MAX_RETRIES` (default: `3`)
- `EVALUATOR_EXECUTE_BACKOFF_MS` (default: `500`)
- `HTTP_MAX_SOCKETS`, `HTTPS_MAX_SOCKETS`, `API_HTTP_TIMEOUT_MS` (optional)

## Data Ingestor (apps/data-ingestor)
- `DEX_SCREENER_API_URL` (optional; default: `https://api.dexscreener.com/latest/dex`)
- `DEX_SCREENER_TIMEOUT_MS` (optional; default: `8000`)
- `INGEST_CHAINS` (optional; default: `ethereum,base,arbitrum`)
- `HL_INGEST_ENABLED` (optional; default: `true`) — enable Hyperliquid mid price ingestion.
- `HL_INGEST_SYMBOLS` (optional; default: `BTC,ETH`) — comma-separated HL symbols to ingest (saved as chain=`hyperliquid`, address=`<SYMBOL>`).
- `SOL_INGEST_ENABLED` (optional; default: `true`) — enable Solana price ingestion via Jupiter.
- `SOL_INGEST_MINTS` (optional; default: empty) — comma-separated list of `mint[:symbol]` pairs (e.g., `So111...:SOL,EPjF...:USDC`).
- `JUPITER_PRICE_API_URL` (optional; default: `https://price.jup.ag/v4/price`) — Solana price endpoint.

## HTTP Client (shared)
- `HTTP_MAX_SOCKETS`, `HTTPS_MAX_SOCKETS` (optional; default: `50`)
- `HTTP_CLIENT_TIMEOUT_MS` (optional; default: `12000`)

## RPC URL Suggestions
Set per-chain RPC URLs via `RPC_URL_<CHAIN>` for backend and `NEXT_PUBLIC_RPC_URL_<CHAIN>` for frontend.

- Ethereum: `RPC_URL_ETHEREUM=https://eth-mainnet.g.alchemy.com/v2/<key>` or `https://mainnet.infura.io/v3/<key>`
- Base: `RPC_URL_BASE=https://base-mainnet.g.alchemy.com/v2/<key>` or `https://mainnet.base.org`
- Arbitrum: `RPC_URL_ARBITRUM=https://arb-mainnet.g.alchemy.com/v2/<key>` or `https://arb1.arbitrum.io/rpc`
- Linea: `RPC_URL_LINEA=https://linea-mainnet.infura.io/v3/<key>` or provider equivalent
- Optimism: `RPC_URL_OPTIMISM=https://optimism-mainnet.infura.io/v3/<key>` or Alchemy
- Polygon: `RPC_URL_POLYGON=https://polygon-mainnet.g.alchemy.com/v2/<key>` or `https://polygon-rpc.com`
- BSC: `RPC_URL_BSC=https://bsc-dataseed.binance.org`
- Avalanche: `RPC_URL_AVALANCHE=https://api.avax.network/ext/bc/C/rpc`
- Sei (EVM): `RPC_URL_SEI=https://evm-rpc.sei-apis.com`

Note: Hyperevm is currently not supported for execution (4337/Safe deployments and bundler availability uncertain). Treat as unsupported until official infra (Safe deployments, bundler, stable RPC) is confirmed.
