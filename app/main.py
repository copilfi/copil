from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from contextlib import asynccontextmanager
from datetime import datetime
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from fastapi.responses import JSONResponse
import asyncio
import logging

from app.core.config import settings
from app.core.logging_config import setup_logging
from app.core.database import init_db, cleanup_connections
from app.api.v1 import portfolio, market, workflows, auth, chat, admin, swap
from app.core.security import setup_security_middleware
from app.services.monitoring.metrics_collector import MetricsCollector
from app.workers.celery_app import celery_app
from app.services.health_checker import HealthChecker
from app.listeners.event_listener import run_listener

# Setup logging as the very first thing
setup_logging()

# Initialize Sentry for error tracking
if settings.SENTRY_DSN and settings.SENTRY_DSN.startswith(('http://', 'https://')):
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        integrations=[
            FastApiIntegration(),
            SqlalchemyIntegration()
        ],
        traces_sample_rate=1.0 if settings.ENVIRONMENT == "development" else 0.1,
        environment=settings.ENVIRONMENT
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    # Startup
    await init_db()
    
    # Initialize monitoring
    metrics_collector = MetricsCollector()
    await metrics_collector.start()
    
    # Start the on-chain event listener as a background task
    # TEMPORARILY DISABLED - causing log spam
    if False and settings.ENVIRONMENT != "testing" and settings.ENABLE_EVENT_LISTENER:
        loop = asyncio.get_running_loop()
        app.state.event_listener_task = loop.create_task(run_listener())
        logging.info("On-chain event listener started in the background.")
    else:
        logging.info("Event listener disabled to prevent log spam.")
    
    # Start background workers
    if settings.ENABLE_BACKGROUND_TASKS:
        celery_app.control.purge()  # Clear any pending tasks
    
    yield
    
    # Shutdown
    # Stop the event listener task
    if hasattr(app.state, "event_listener_task") and app.state.event_listener_task:
        app.state.event_listener_task.cancel()
        logging.info("On-chain event listener stopped.")
        
    await cleanup_connections()
    
    if settings.ENABLE_BACKGROUND_TASKS:
        celery_app.control.shutdown()


# Create FastAPI application
app = FastAPI(
    title="Copil API",
    description="AI-Powered DeFi Automation Platform",
    version="1.0.0",
    docs_url="/docs" if settings.ENVIRONMENT != "production" else None,
    redoc_url="/redoc" if settings.ENVIRONMENT != "production" else None,
    lifespan=lifespan
)

# Security middleware
app.add_middleware(
    TrustedHostMiddleware, 
    allowed_hosts=settings.ALLOWED_HOSTS
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Custom security middleware
setup_security_middleware(app)

# API routes
# Note: Using a consistent prefix from settings for all v1 routes.
# All new routers should be added here.
app.include_router(auth.router, prefix=f"{settings.API_V1_STR}/auth", tags=["Auth"])
app.include_router(chat.router, prefix=f"{settings.API_V1_STR}/chat", tags=["AI Chat"])
app.include_router(portfolio.router, prefix=f"{settings.API_V1_STR}/portfolio", tags=["Portfolio"])
app.include_router(swap.router, prefix=f"{settings.API_V1_STR}/swap", tags=["Swap"])
app.include_router(workflows.router, prefix=f"{settings.API_V1_STR}/workflows", tags=["Workflows"])
app.include_router(market.router, prefix=f"{settings.API_V1_STR}/market", tags=["Market Data"])
app.include_router(admin.router, prefix=f"{settings.API_V1_STR}/admin", tags=["Admin"])


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "message": "Copil API",
        "version": "1.0.0",
        "status": "operational",
        "environment": settings.ENVIRONMENT
    }


@app.get("/health")
async def health_check():
    """Detailed health check for monitoring"""
    checker = HealthChecker()
    report = await checker.check_all()
    
    status_code = 200 if report["status"] == "healthy" else 503
    
    return JSONResponse(content=report, status_code=status_code)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.ENVIRONMENT == "development"
    ) 