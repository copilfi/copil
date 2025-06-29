# Copil Backend API

AI-Powered DeFi Automation Platform Backend

## 🏗️ Architecture Overview

Copil is a sophisticated FastAPI-based backend that powers an AI-driven DeFi automation platform. The system enables users to create automated workflows for blockchain operations, interact with AI chat services, and manage cross-chain portfolios.

### Core Components

- **FastAPI Application**: Modern, fast web framework with automatic OpenAPI documentation
- **AI Integration**: Multi-provider AI services (OpenAI, Amazon Bedrock) for intelligent automation
- **Blockchain Adapters**: Cross-chain operations via OneBalance and direct Web3 integration
- **Workflow Engine**: Automated trigger-based execution system
- **Authentication**: Privy-based Web3 authentication with JWT tokens
- **Background Processing**: Celery-based asynchronous task queue
- **Real-time Monitoring**: Health checks, metrics collection, and external service monitoring

## 🚀 Tech Stack

### Core Framework
- **FastAPI** 0.111.0 - Modern web framework
- **Uvicorn** 0.30.1 - ASGI server
- **Pydantic** 2.8.2 - Data validation and settings

### Database
- **SQLAlchemy** 2.0.31 - ORM and database toolkit
- **Alembic** 1.13.1 - Database migrations
- **PostgreSQL** - Primary database (via asyncpg/psycopg2)

### Authentication & Security
- **Python-JOSE** 3.3.0 - JWT token handling
- **Passlib** 1.7.4 - Password hashing
- **BCrypt** 4.1.3 - Secure password hashing

### Blockchain & Web3
- **Web3** 6.20.0 - Ethereum blockchain interaction
- **OneBalance SDK** - Cross-chain operations
- **Privy** - Web3 authentication provider

### Background Processing
- **Celery** 5.4.0 - Distributed task queue
- **Redis** 5.0.7 - Message broker and caching

### AI Services
- **OpenAI SDK** - GPT integration
- **AWS Boto3** - Amazon Bedrock integration
- **Anthropic** - Claude AI integration

### Monitoring & External APIs
- **Sentry** - Error tracking
- **Tweepy** - Twitter API integration
- **Requests** - HTTP client for external APIs

## 📁 Project Structure

```
backend/
├── app/
│   ├── api/v1/              # API endpoints
│   │   ├── auth.py          # Authentication endpoints
│   │   ├── chat.py          # AI chat endpoints
│   │   ├── workflows.py     # Workflow management
│   │   ├── market.py        # Market data endpoints
│   │   ├── swap.py          # Token swap operations
│   │   ├── portfolio.py     # Portfolio management
│   │   └── admin.py         # Admin endpoints
│   ├── core/                # Core configurations
│   │   ├── config.py        # Application settings
│   │   ├── database.py      # Database connection
│   │   ├── security.py      # Security middleware
│   │   └── logging_config.py# Logging setup
│   ├── models/              # SQLAlchemy models
│   │   ├── user.py          # User model
│   │   ├── workflow.py      # Workflow models
│   │   ├── portfolio.py     # Portfolio models
│   │   └── security.py      # Security models
│   ├── schemas/             # Pydantic schemas
│   │   ├── auth.py          # Auth schemas
│   │   ├── workflow.py      # Workflow schemas
│   │   └── chat.py          # Chat schemas
│   ├── services/            # Business logic services
│   │   ├── ai/              # AI service providers
│   │   ├── blockchain/      # Blockchain adapters
│   │   ├── auth/            # Authentication services
│   │   ├── market/          # Market data services
│   │   ├── security/        # Security services
│   │   └── monitoring/      # Monitoring services
│   ├── workers/             # Background task workers
│   ├── utils/               # Utility functions
│   └── main.py              # FastAPI application
├── alembic/                 # Database migrations
├── monitoring/              # Monitoring configurations
├── scripts/                 # Utility scripts
├── requirements.txt         # Python dependencies
└── .env.example            # Environment template
```

## 🔧 Setup & Installation

### Prerequisites

- Python 3.9+
- PostgreSQL 12+
- Redis 6+
- Git

### 1. Clone & Environment Setup

```bash
git clone https://github.com/copilfi/copil.git
cd copil
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Environment Configuration

```bash
cp .env.example .env
# Edit .env with your configuration values
```

### 4. Database Setup

```bash
# Create PostgreSQL database
createdb copil_db

# Run migrations
alembic upgrade head
```

### 5. Redis Setup

Ensure Redis is running:
```bash
redis-server
```

### 6. Run Application

#### Development Mode
```bash
python -m app.main
# or
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

#### Production Mode
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

### 7. Background Workers

In a separate terminal:
```bash
celery -A app.workers.celery_app worker --loglevel=info
```

## 🔑 Environment Variables

Create a `.env` file with the following variables:

### Core Application
```env
ENVIRONMENT=development
DEBUG=true
SECRET_KEY=your-secret-key-here
DATABASE_URL=postgresql://username:password@localhost:5432/copil_db
REDIS_URL=redis://localhost:6379/0
```

### External APIs
```env
# OneBalance (Cross-chain operations)
ONEBALANCE_API_KEY=your-onebalance-api-key

# Privy (Web3 Authentication)
PRIVY_APP_ID=your-privy-app-id
PRIVY_APP_SECRET=your-privy-app-secret
PRIVY_VERIFICATION_KEY=your-privy-verification-key

# AI Services
OPENAI_API_KEY=your-openai-api-key  # Optional
AWS_REGION_NAME=us-east-1           # For Bedrock

# Blockchain RPCs
ALCHEMY_API_KEY=your-alchemy-api-key
EVM_RPC_URL=your-rpc-url

# Market Data
COINGECKO_API_KEY=your-coingecko-api-key
TWITTER_BEARER_TOKEN=your-twitter-token
```

### Security & Development
```env
PRIVATE_KEY=your-development-private-key  # DEV ONLY - DO NOT USE IN PRODUCTION
```

## 📊 API Endpoints

### Authentication
- `POST /api/v1/auth/login/privy` - Privy Web3 login
- `GET /api/v1/auth/me` - Get current user info

### AI Chat
- `POST /api/v1/chat/send` - Send message to AI assistant
- `GET /api/v1/chat/history` - Get chat history

### Workflows
- `GET /api/v1/workflows` - List user workflows
- `POST /api/v1/workflows` - Create new workflow
- `PUT /api/v1/workflows/{id}` - Update workflow
- `DELETE /api/v1/workflows/{id}` - Delete workflow
- `POST /api/v1/workflows/{id}/execute` - Execute workflow

### Market Data
- `GET /api/v1/market/price/{symbol}` - Get token price
- `GET /api/v1/market/trending` - Get trending tokens

### Portfolio
- `GET /api/v1/portfolio/balance` - Get portfolio balance
- `GET /api/v1/portfolio/history` - Get transaction history

### Token Swaps
- `POST /api/v1/swap/quote` - Get swap quote
- `POST /api/v1/swap/execute` - Execute token swap

## 🧪 API Documentation

When running in development mode, interactive API documentation is available at:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## 🏥 Health Monitoring

### Health Check Endpoints
- `GET /` - Basic health check
- `GET /health` - Detailed system health status

### Monitoring Features
- Database connection monitoring
- Redis connection monitoring
- External API availability checks
- Background worker status
- System resource monitoring

## 🔒 Security Features

### Authentication & Authorization
- JWT-based authentication with Privy Web3 provider
- Secure session management with encrypted private keys
- Rate limiting and request throttling
- CORS protection with configurable origins

### Data Protection
- Sensitive data encryption using AWS KMS
- Environment-based secret management
- SQL injection prevention via SQLAlchemy ORM
- Input validation with Pydantic schemas

### Security Middleware
- Trusted host validation
- Security headers injection
- Request size limiting
- Custom security middleware for additional protection

## 🔄 Background Tasks

The application uses Celery for background processing:

### Task Types
- **Workflow Execution**: Automated workflow triggers and actions
- **Market Data Updates**: Periodic price and trending data refresh
- **Event Processing**: Blockchain event monitoring and processing
- **Notifications**: Email and push notification delivery

### Worker Management
```bash
# Start worker
celery -A app.workers.celery_app worker --loglevel=info

# Monitor tasks
celery -A app.workers.celery_app flower

# Purge tasks
celery -A app.workers.celery_app purge
```

## 🧪 Testing

### Run Tests
```bash
pytest app/tests/

# With coverage
pytest --cov=app app/tests/
```

### Test Environment Setup
```bash
export ENVIRONMENT=testing
export TEST_DATABASE_URL=postgresql://username:password@localhost:5432/copil_test_db
```

## 📚 Development Guidelines

### Code Style
- Follow PEP 8 standards
- Use type hints for all function parameters and returns
- Implement comprehensive error handling
- Write docstrings for all public functions and classes

### Database Migrations
```bash
# Create new migration
alembic revision --autogenerate -m "Description of changes"

# Apply migrations
alembic upgrade head

# Rollback migration
alembic downgrade -1
```

### Adding New Features
1. Create appropriate models in `app/models/`
2. Define Pydantic schemas in `app/schemas/`
3. Implement business logic in `app/services/`
4. Create API endpoints in `app/api/v1/`
5. Add background tasks in `app/workers/` if needed
6. Update this README with new endpoints

## 🚀 Deployment

### Production Considerations
- Use environment variables for all configuration
- Enable Sentry for error tracking
- Configure proper logging levels
- Set up database connection pooling
- Use Redis for session storage and caching
- Implement proper backup strategies

### Docker Deployment
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

## 📄 License

This project is proprietary software. All rights reserved.

## 🆘 Support

For support and questions:
- Create an issue in the GitHub repository
- Contact the development team
- Check the API documentation at `/docs` endpoint

---

**Note**: This is a development backend for the Copil DeFi automation platform. Ensure all security measures are properly configured before deploying to production.
