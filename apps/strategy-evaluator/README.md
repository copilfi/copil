# Strategy Evaluator

BullMQ worker that evaluates automation strategy triggers and queues transactions.

## Description

Background worker that continuously checks user-defined automation strategies (price triggers, time-based schedules) and dispatches transaction jobs when conditions are met.

## What You'll Find Here

- Price trigger evaluation that monitors token prices against user-defined thresholds
- Time-based scheduling for cron-based automation strategies
- Transaction dispatching to the transaction queue when conditions are met
- Strategy management that auto-deactivates one-time strategies after execution
- BullMQ integration for reliable job processing with retry and backoff

## Run Locally

Prerequisites: Docker (for Postgres + Redis) and Node 20+

```bash
# Start infrastructure
docker compose up -d

# From monorepo root
npm install
npm run dev
```

Services:
- Health: http://localhost:3003/health


## How It Works

The evaluator consumes jobs from the strategy queue, checks price/time triggers using token price data, calls the internal API to create transaction jobs, and updates strategy status accordingly.

## Contact

For updates or collaboration inquiries, please use the official support channels or contact the maintainers directly.
