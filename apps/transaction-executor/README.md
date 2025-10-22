# Transaction Executor

BullMQ worker that signs and broadcasts blockchain transactions.

## Description

Background worker that consumes transaction jobs from the queue, signs them using session keys, and broadcasts to the blockchain via bundlers or RPC providers.

## What You'll Find Here

- Session key signing for authorized transactions
- ERC-4337 UserOperation bundling via Pimlico
- Paymaster integration for optional gas sponsorship
- Multi-chain support for EVM chains (via viem), Hyperliquid, and Solana
- Policy enforcement that validates session key permissions and spend limits
- Retry logic with automatic exponential backoff
- Metrics tracking for EVM and Solana transaction success/failure rates

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
- Health: http://localhost:3005/health
- Metrics: http://localhost:3005/metrics/evm
- Metrics: http://localhost:3005/metrics/solana


## How It Works

The executor consumes jobs from the transaction queue, validates session key permissions and limits, signs with the appropriate session key private key, broadcasts via Pimlico bundler or direct RPC, and records the result in the transaction log table.

## Contact

For updates or collaboration inquiries, please use the official support channels or contact the maintainers directly.
