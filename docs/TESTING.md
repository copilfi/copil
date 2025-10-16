# Testing & E2E

## Unit Tests

- Each workspace ships with Jest configuration. Examples:
  - API: `npm test --workspace apps/api`
  - Transaction Executor: `npm test --workspace apps/transaction-executor`

## Executor Approval Flow Tests

- See `apps/transaction-executor/test/execution.service.spec.ts` for approval→swap test cases. The test stubs allowance reading and owner address to avoid RPC calls.

## Smoke / E2E Sanity

- Bring up infra and services (locally):
  - `docker compose up -d`
  - `npm install`
  - Build shared pkg: `npm run build -w @copil/database`
  - Run migrations: `npm --workspace apps/api run migration:run`
  - Start services: `npm run dev`

- In a separate terminal, run:
  - `npm run e2e:smoke`

It will poll the following endpoints until healthy:

- API: `GET /health`
- Strategy Evaluator: `http://localhost:3003/health`
- Data Ingestor: `http://localhost:3004/health`
- Transaction Executor: `http://localhost:3005/health`

Override ports via `STRATEGY_EVALUATOR_PORT`, `DATA_INGESTOR_PORT`, `TX_EXECUTOR_PORT` or `HEALTH_PORT`.

