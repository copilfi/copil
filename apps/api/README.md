# Copil API

Main backend API service for the Copil platform.

## Description

Primary RESTful API handling authentication, portfolio management, transaction orchestration, and AI chat interface.

## Key Features

- **Auth:** Privy JWT authentication and session key authorization
- **Chat:** LangChain-powered AI agent (enable with `CHAT_ENABLED=true`)
- **Portfolio:** Multi-chain balance queries via OneBalance API
- **Transactions:** Quote comparison, swap/bridge execution, idempotency support
- **Automations:** Strategy CRUD with price/time triggers
- **Session Keys:** Permission management with spend limits and contract allowlists
- **Smart Account:** Safe wallet deployment orchestration
- **Onboarding:** User onboarding flow and funding recommendations
- **Policy:** Safe Guard configuration management

## Run Locally

Prerequisites: Docker (for Postgres + Redis) and Node 20+

```bash
# Start infrastructure
docker compose up -d

# From monorepo root
npm install
npm run build -w @copil/database
npm --workspace apps/api run migration:run
npm run dev
```

Services:
- API: http://localhost:4311
- Health: http://localhost:4311/health


## Contact

For updates or collaboration inquiries, please use the official support channels or contact the maintainers directly.
