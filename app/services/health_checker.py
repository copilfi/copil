from datetime import datetime
import time
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from redis.asyncio import Redis

from app.core.database import get_db, get_redis
from app.core.config import settings
from app.services.monitoring.external_service_checkers import get_external_service_checkers

logger = logging.getLogger(settings.APP_NAME)


class HealthChecker:
    """
    Comprehensive health checker for all system components.
    
    Checks:
    - Database connectivity (PostgreSQL)
    - Cache connectivity (Redis) 
    - External services (OneBalance, Privy, Chainlink)
    - Internal services status
    """
    
    def __init__(self):
        self.external_checkers = get_external_service_checkers()
        self.results = {
            "status": "healthy",
            "timestamp": "",
            "duration": 0.0,
            "checks": {}
        }

    async def check_all(self):
        """Run comprehensive health checks for all system components"""
        start_time = time.monotonic()
        logger.info("Starting comprehensive health check")
        
        # We need to handle async generators from database.py correctly
        db_gen = get_db()
        redis_client = await get_redis()
        
        try:
            db_session = await anext(db_gen)
            await self.check_database(db_session)
            await self.check_redis(redis_client)
            await self.check_external_services()
        finally:
            # Ensure the generator is closed
            try:
                await anext(db_gen)
            except StopAsyncIteration:
                pass

        end_time = time.monotonic()
        
        self.results["timestamp"] = str(datetime.utcnow())
        self.results["duration"] = round(end_time - start_time, 4)

        # Determine overall health status
        unhealthy_services = [
            name for name, check in self.results["checks"].items() 
            if check.get("status") == "unhealthy"
        ]
        
        if unhealthy_services:
            self.results["status"] = "unhealthy" 
            logger.warning(f"Health check completed with issues: {unhealthy_services}")
        else:
            logger.info("Health check completed successfully - all services healthy")
            
        return self.results

    async def check_database(self, db_session: AsyncSession):
        """Check PostgreSQL database connectivity"""
        try:
            logger.debug("Checking database connectivity")
            result = await db_session.execute(text("SELECT 1"))
            result.fetchone()
            self._add_check("database", "healthy", {"details": "PostgreSQL connection successful"})
            logger.debug("Database health check passed")
        except Exception as e:
            logger.error(f"Database health check failed: {e}")
            self._add_check("database", "unhealthy", {"error": str(e)})

    async def check_redis(self, redis_client: Redis):
        """Check Redis cache connectivity"""
        try:
            logger.debug("Checking Redis connectivity")
            pong = await redis_client.ping()
            if pong:
                self._add_check("redis", "healthy", {"details": "Redis connection successful"})
                logger.debug("Redis health check passed")
            else:
                self._add_check("redis", "unhealthy", {"error": "Redis ping failed"})
        except Exception as e:
            logger.error(f"Redis health check failed: {e}")
            self._add_check("redis", "unhealthy", {"error": str(e)})

    async def check_external_services(self):
        """Check external API services status using dedicated checkers"""
        logger.info("Starting external services health checks")
        
        for service_name, checker in self.external_checkers.items():
            try:
                logger.debug(f"Checking {service_name} service health")
                check_result = await checker.check_health()
                
                self.results["checks"][service_name] = check_result
                
                if check_result["status"] != "healthy":
                    logger.warning(f"{service_name} service health check failed: {check_result}")
                else:
                    logger.debug(f"{service_name} service is healthy")
                    
            except Exception as e:
                logger.error(f"Exception during {service_name} health check: {e}")
                self.results["checks"][service_name] = {
                    "status": "unhealthy",
                    "error": f"Health check exception: {str(e)}"
                }
            
    def _add_check(self, name: str, status: str, data: dict = None):
        """Add a health check result to the results dictionary"""
        self.results["checks"][name] = {"status": status}
        if data:
            self.results["checks"][name].update(data) 