import logging
from redis.asyncio import Redis
from sqlalchemy import text, create_engine
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import settings

logger = logging.getLogger(settings.APP_NAME)

# SQLAlchemy declarative base
Base = declarative_base()

# Global database variables
async_engine = None
async_session_local = None
redis_client = None

# Sync database (for legacy endpoints)
sync_engine = None
SessionLocal = None

async def init_db():
    """Initialize database and Redis connections"""
    global async_engine, async_session_local, redis_client, sync_engine, SessionLocal
    
    try:
        # Initialize PostgreSQL (Async)
        async_engine = create_async_engine(
            settings.get_database_url(),
            pool_size=settings.DATABASE_POOL_SIZE,
            max_overflow=settings.DATABASE_MAX_OVERFLOW,
            echo=settings.DATABASE_ECHO,
        )

        # Test database connection
        async with async_engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
        logger.info("Database connection successful.")

        async_session_local = async_sessionmaker(
            bind=async_engine, 
            autocommit=False, 
            autoflush=False, 
            class_=AsyncSession
        )

        # Initialize PostgreSQL (Sync for legacy endpoints)
        sync_db_url = settings.get_database_url().replace("+asyncpg", "")  # Remove async driver
        sync_engine = create_engine(
            sync_db_url,
            pool_size=settings.DATABASE_POOL_SIZE,
            max_overflow=settings.DATABASE_MAX_OVERFLOW,
            echo=settings.DATABASE_ECHO,
        )
        
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=sync_engine)

        # Initialize Redis
        redis_client = Redis.from_url(settings.REDIS_URL, decode_responses=True)
        await redis_client.ping()
        logger.info("Redis connection successful.")

    except Exception as e:
        logger.error(f"Failed to initialize database connections: {e}")
        raise

async def cleanup_connections():
    """Cleanup database and Redis connections"""
    global async_engine, redis_client, sync_engine
    if async_engine:
        await async_engine.dispose()
        logger.info("Async database connection pool closed.")
    if sync_engine:
        sync_engine.dispose()
        logger.info("Sync database connection pool closed.")
    if redis_client:
        await redis_client.close()
        logger.info("Redis connection closed.")

async def get_db() -> AsyncSession:
    """Dependency to get a DB session."""
    if not async_session_local:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    
    async with async_session_local() as session:
        yield session

async def get_redis() -> Redis:
    """Dependency to get a Redis client."""
    if not redis_client:
        raise RuntimeError("Redis not initialized. Call init_db() first.")
    return redis_client 