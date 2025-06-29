"""
External Service Health Checkers

This module contains health check implementations for external services.
Each service has its own dedicated checker class that can be easily tested and maintained.
"""

import httpx
import logging
from abc import ABC, abstractmethod
from typing import Dict, Any

from app.core.config import settings

logger = logging.getLogger(settings.APP_NAME)


class ExternalServiceChecker(ABC):
    """Abstract base class for external service health checkers"""
    
    @abstractmethod
    async def check_health(self) -> Dict[str, Any]:
        """Check the health of the external service"""
        pass
    
    @property
    @abstractmethod
    def service_name(self) -> str:
        """Return the name of the service"""
        pass


class OneBalanceServiceChecker(ExternalServiceChecker):
    """Health checker for OneBalance API service"""
    
    def __init__(self):
        self.base_url = settings.ONEBALANCE_API_URL
        self.timeout = 10
    
    @property
    def service_name(self) -> str:
        return "onebalance_api"
    
    async def check_health(self) -> Dict[str, Any]:
        """
        Check OneBalance API health status
        """
        # Temporarily skip OneBalance health check until correct endpoint is found
        if not settings.ONEBALANCE_API_KEY:
            return {
                "status": "unhealthy",
                "error": "OneBalance API key not configured"
            }
        
        # For now, assume healthy if API key is present
        # TODO: Find correct OneBalance health endpoint
        return {
            "status": "healthy",
            "details": "OneBalance API key configured (health endpoint TBD)"
        }


class PrivyServiceChecker(ExternalServiceChecker):
    """Health checker for Privy authentication service"""
    
    def __init__(self):
        self.base_url = "https://auth.privy.io"
        self.timeout = 10
    
    @property
    def service_name(self) -> str:
        return "privy_api"
    
    async def check_health(self) -> Dict[str, Any]:
        """
        Check Privy API health status by verifying app configuration
        """
        if not settings.PRIVY_APP_ID or not settings.PRIVY_APP_SECRET:
            return {
                "status": "unhealthy",
                "error": "Privy credentials not configured"
            }
        
        try:
            async with httpx.AsyncClient() as client:
                # Check app status endpoint
                app_url = f"{self.base_url}/api/v1/apps/{settings.PRIVY_APP_ID}"
                
                response = await client.get(
                    app_url,
                    timeout=self.timeout,
                    headers={
                        "privy-app-id": settings.PRIVY_APP_ID,
                        "Authorization": f"Basic {settings.PRIVY_APP_SECRET}",
                        "User-Agent": "Copil-HealthChecker/1.0"
                    }
                )
                
                if response.status_code == 200:
                    response_data = response.json()
                    is_valid_app = response_data.get("id") == settings.PRIVY_APP_ID
                    
                    return {
                        "status": "healthy" if is_valid_app else "unhealthy",
                        "response_time_ms": response.elapsed.total_seconds() * 1000,
                        "status_code": response.status_code,
                        "app_id_valid": is_valid_app,
                        "details": {
                            "app_name": response_data.get("name"),
                            "app_id": response_data.get("id")
                        }
                    }
                else:
                    return {
                        "status": "unhealthy",
                        "error": f"HTTP {response.status_code}",
                        "response_time_ms": response.elapsed.total_seconds() * 1000,
                        "status_code": response.status_code
                    }
                    
        except httpx.TimeoutException:
            logger.warning(f"Privy health check timed out after {self.timeout}s")
            return {
                "status": "unhealthy",
                "error": f"Request timeout after {self.timeout}s"
            }
        except httpx.RequestError as e:
            logger.error(f"Privy health check failed: {e}")
            return {
                "status": "unhealthy",
                "error": f"Request error: {e.__class__.__name__}"
            }
        except Exception as e:
            logger.error(f"Unexpected error in Privy health check: {e}")
            return {
                "status": "unhealthy",
                "error": f"Unexpected error: {str(e)}"
            }


class ChainlinkServiceChecker(ExternalServiceChecker):
    """Health checker for Chainlink services (price feeds, automation)"""
    
    def __init__(self):
        self.timeout = 15
    
    @property
    def service_name(self) -> str:
        return "chainlink_services"
    
    async def check_health(self) -> Dict[str, Any]:
        """
        Check Chainlink services by testing blockchain connectivity
        """
        try:
            # Import blockchain manager to check Web3 connections
            from app.services.blockchain.manager import blockchain_manager
            
            # Get health status from our blockchain manager
            blockchain_health = await blockchain_manager.health_check()
            
            # Extract Chainlink-related information
            fallback_service = blockchain_health.get("fallback_service", {})
            healthy_chains = fallback_service.get("healthy_chains", [])
            
            if len(healthy_chains) > 0:
                return {
                    "status": "healthy",
                    "details": {
                        "healthy_chains": len(healthy_chains),
                        "chain_info": healthy_chains
                    }
                }
            else:
                return {
                    "status": "unhealthy",
                    "error": "No healthy blockchain connections available"
                }
                
        except Exception as e:
            logger.error(f"Chainlink health check failed: {e}")
            return {
                "status": "unhealthy",
                "error": f"Blockchain connectivity check failed: {str(e)}"
            }


# Factory function to get all external service checkers
def get_external_service_checkers() -> Dict[str, ExternalServiceChecker]:
    """Return a dictionary of all external service checkers"""
    return {
        "onebalance": OneBalanceServiceChecker(),
        "privy": PrivyServiceChecker(),
        "chainlink": ChainlinkServiceChecker()
    } 