# Data Ingestor

Background service that collects and stores market data for the Copil platform.

## Description

Scheduled worker that continuously fetches token prices, trending tokens, and social sentiment data to power AI recommendations and automation triggers.

## What You'll Find Here

- DexScreener integration that fetches trending tokens, volumes, and price changes across chains
- Twitter sentiment analysis for crypto-related market data
- Token price tracking stored in PostgreSQL for automation triggers
- Scheduled tasks using NestJS Schedule for periodic data collection

## Run Locally

Prerequisites: Docker (for Postgres) and Node 20+

```bash
# Start infrastructure
docker compose up -d

# From monorepo root
npm install
npm run dev
```

Services:
- Health: http://localhost:3004/health



## Contact

For updates or collaboration inquiries, please use the official support channels or contact the maintainers directly.
