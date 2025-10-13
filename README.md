# Copil

Copil is an AI-powered companion for decentralized finance. The platform aims to make complex on-chain actions feel effortless by pairing conversational guidance with safe automation. Users can explore market opportunities, request insights, and delegate repetitive tasks while retaining full custody of their assets.

## What You’ll Find Here

- A web experience designed to welcome people who are curious about DeFi but overwhelmed by jargon.
- Services that listen to user goals, learn from market signals, and suggest the next best action.
- An automation layer that keeps portfolios on track even when the user is away from the screen.

The repository continues to evolve alongside the product vision. As the team iterates, expect improvements to education resources, proactive notifications, and the overall feeling of being supported by a trusted digital co-pilot.

## Getting Involved

Whether you are testing the product, sharing feedback, or exploring partnership ideas, every contribution helps shape Copil into a more intuitive guide. Reach out to the team with your questions or suggestions—we’re building this experience together.

## Contact

For updates or collaboration inquiries, please use the official support channels or contact the maintainers directly.

## Run Locally

Prerequisites:
- Docker (for Postgres + Redis) and Node 20+
- Environment variables set in each app (see sample `.env` files in `apps/*`)

Steps:
- Start infra: `docker compose up -d`
- Install deps: `npm install`
- Build shared package: `npm run build -w @copil/database`
- Run DB migrations: `npm --workspace apps/api run migration:run`
- Dev servers (all workspaces): `npm run dev` (spawns: web, api, data-ingestor, strategy-evaluator, transaction-executor)

Services:
- Web: http://localhost:3000
- API: http://localhost:3001
- Postgres: `localhost:5432` (db: `copil`/`copil`)
- Redis: `localhost:6379`
- Transaction Executor (BullMQ worker): consumes `transaction-queue` jobs and records transaction logs

Login flow:
- Use the login page to create a session (email + privyDid). The web app stores a JWT in an HTTP-only cookie and proxies calls to the API.

Automations:
- Create an automation in `/(dashboard)/automations/builder`.
- Builder form captures price-trigger details and downstream action metadata (swap/custom). Previous JSON-only definitions are still accepted but deprecated.
- Active strategies are scheduled into BullMQ (`strategy-queue`). The Strategy Evaluator evaluates simple price triggers using data from the Data Ingestor, and can deactivate a strategy when its condition is met.
- Executed actions emit transaction logs that are visible from the dashboard and via the API endpoint `/transaction/logs`.
- Session keys (managed via `/session-keys`) gate automated execution; strategies should reference a valid `sessionKeyId` so downstream jobs have scoped signing authority.
- Use the Session Keys dashboard tab to register keys and toggle their status; the automation builder consumes that list when creating strategies.
- Transaction executor now attempts to broadcast swap/bridge transactions automatically; if signer configuration is missing, logs show "skipped" status with payloads you can sign manually.

### Configuration

- Swap execution relies on an external aggregator (e.g., 0x or 1inch). Configure environment variables for the transaction executor service:
  - `SWAP_AGGREGATOR_BASE_URL` (and optional per-chain overrides such as `SWAP_AGGREGATOR_BASE_URL_BASE`)
  - `SWAP_AGGREGATOR_API_KEY` if the chosen aggregator requires it
- LI.FI requests use `LIFI_API_BASE_URL` and `LIFI_API_KEY` when present; otherwise the default public endpoint is used.
- Session key permissions support optional `actions` (`swap`, `bridge`, `custom`) and `chains` lists. The executor enforces these constraints before attempting a transaction.
- Signer integration expects RPC endpoints and session key private keys:
  - `RPC_URL_<CHAIN>` (e.g., `RPC_URL_ETHEREUM`, `RPC_URL_BASE`) or a fallback `RPC_URL`
  - `SESSION_KEY_<ID>_PRIVATE_KEY` per registered session key (falls back to `SESSION_KEY_PRIVATE_KEY`)

### Testing

- Unit tests live under each workspace (`npm test --workspace transaction-executor`, `npm test --workspace api`, etc.).
- In constrained environments (e.g., this CLI sandbox) Jest worker processes may crash before executing; rerun locally with full system access to validate changes.
