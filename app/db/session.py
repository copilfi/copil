from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from typing import AsyncGenerator

from app.core.config import settings

# Create an asynchronous engine
async_engine = create_async_engine(
    settings.get_database_url(async_driver=True),
    pool_pre_ping=True,
    pool_size=settings.DATABASE_POOL_SIZE,
    max_overflow=settings.DATABASE_MAX_OVERFLOW,
    echo=settings.DATABASE_ECHO,
)

# Create a sessionmaker for the asynchronous engine
AsyncSessionFactory = sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency to get an async database session.
    Yields a session and ensures it's closed after the request is finished.
    """
    async with AsyncSessionFactory() as session:
        try:
            yield session
        finally:
            await session.close()

# Alias for compatibility
async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Alias for get_db"""
    async with AsyncSessionFactory() as session:
        try:
            yield session
        finally:
            await session.close()

async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    """Another alias for compatibility"""
    async with AsyncSessionFactory() as session:
        try:
            yield session
        finally:
            await session.close()

# For non-async contexts
Session = AsyncSessionFactory

# Another alias for compatibility with different import patterns
get_db = get_db_session 