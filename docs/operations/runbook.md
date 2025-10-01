# Operational Runbook

## 1. Prerequisites
- Node.js 18.17+ and npm 9+
- Docker Desktop (for Postgres, Redis, and supporting services)
- Alchemy Sei RPC credentials configured in `.env`
- `.env` populated for API (see `apps/api/.env.example` if present)
- `AUTOMATION_PRIVATE_KEY` set to the production smart-account owner (32-byte hex string with `0x` prefix); session keys cannot be provisioned without it

## 2. One-Command Developer Stack
The root-level `npm start` (alias `npm run stack`) performs:
1. `docker compose -f infrastructure/docker/docker-compose.dev.yml up -d` to start Postgres, Redis, etc.
2. `npm run dev --workspace=@copil/api` to launch the API gateway with live reload.
3. `npm run dev` inside `frontend/` to boot the Vite UI.

```bash
npm start
```

Endpoints after startup:
- API Gateway: http://localhost:8888/api
- WebSocket: http://localhost:8888/socket.io
- Frontend: http://localhost:5173

Press `Ctrl+C` to stop; the script forwards SIGINT/SIGTERM to child processes.

## 3. Environment Health Checklist
Run after every restart/deploy:
- `curl http://localhost:8888/api/health` → expect `success: true`
- `curl http://localhost:8888/api/info` → confirm correct chainId (1329 mainnet, 1328 testnet)
- `redis-cli -u $REDIS_URL ping` → expect `PONG`
- `docker ps` → ensure `copil-postgres-dev` and `copil-redis-dev` containers are up

## 4. Database & Migrations
Apply migrations (already tracked in Git) with:
```bash
cd apps/api
npx prisma migrate status --schema=prisma/schema.prisma
npx prisma migrate deploy --schema=prisma/schema.prisma   # when new migrations exist
```

Seed or sync registries:
```bash
npm run db:seed --workspace=@copil/api             # synchronizes token registry, strategies, etc.
node scripts/seed-indexed-contracts.cjs            # ensures AccountFactory and ConditionalOrderEngine are indexed
node scripts/list-indexed-contracts.cjs            # verify current registry state
```

## 5. Event Indexing Expectations
- `AccountFactory` and `ConditionalOrderEngine` must appear in `indexed_contracts`.
- API logs should show: `Event indexing service initialized with 2 contract(s)`.
- Portfolio calls (`/api/portfolio/summary`) must complete without `BAD_DATA` errors.
- Alchemy rate-limit warnings are expected on the free tier; system auto-recovers.
- Block range is controlled via `EVENT_INDEX_BLOCK_RANGE` (defaults to 10) to satisfy free-tier `eth_getLogs` limits. Increase only after upgrading the RPC plan.

## 6. Auth & Session Hardening Notes
- Refresh tokens are stored in Redis as whitelisted families. Clearing Redis invalidates sessions.
- Use `POST /api/auth/logout` to blacklist access tokens and rotate refresh tokens.
- Frontend automatically retries once for 401 responses; persistent failures trigger a UI toast and logout.
- Automation session keys: the strategy engine requires `AUTOMATION_PRIVATE_KEY`. Missing or malformed values will cause strategy execution to fail with `Automation signer not configured` errors.

## 7. Deployment Outline
Production deployment should perform:
1. `npm run build --workspace=@copil/api`
2. `npm run build --prefix frontend`
3. Containerize (see `infrastructure/docker/docker-compose.prod.yml`) or deploy via `infrastructure/kubernetes/` manifests.
4. Run event indexer with the same environment values used in staging (Alchemy RPC, contract addresses).
5. Monitor Redis, Postgres, and API logs; alerts for `Unknown condition type` or `Token family mismatch` require investigation.

## 8. Troubleshooting Quick Tips
- **Postgres unreachable**: ensure Docker container is running; check port conflicts with `lsof -i :5432`.
- **Redis circuit breaker open**: service retries every 30s; verify container logs and credentials.
- **Portfolio missing balances**: run token registry seed and confirm `assetlist.json` matches Sei contracts.
- **Strategies not firing**: run the strategy audit utility (`apps/api/scripts/audit-strategy-conditions.cjs`) and restart the execution engine.

Keep this runbook updated as new infrastructure components are added.
