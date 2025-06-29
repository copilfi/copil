# backend/app/services/blockchain/manager.py
from typing import Dict, Any, List
import logging
from datetime import datetime, timezone
from pybreaker import CircuitBreaker, CircuitBreakerError

from app.core.config import settings
from app.services.blockchain.base import BlockchainServiceInterface, SwapQuote, TransactionResult, BlockchainServiceException
from app.services.blockchain.adapters.onebalance import OneBalanceAdapter
from app.services.blockchain.adapters.web3_fallback import DirectWeb3Adapter

logger = logging.getLogger(settings.APP_NAME)

class BlockchainServiceManager(BlockchainServiceInterface):
    """
    Manages the primary and fallback blockchain service adapters.
    It implements a circuit breaker pattern to switch to the fallback
    service if the primary service is unavailable.
    """

    def __init__(self):
        self.primary_service: BlockchainServiceInterface = OneBalanceAdapter()
        self.fallback_service: BlockchainServiceInterface = DirectWeb3Adapter()
        
        # Initialize Circuit Breaker
        self.breaker = CircuitBreaker(
            fail_max=settings.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
            reset_timeout=settings.CIRCUIT_BREAKER_RECOVERY_TIMEOUT,
            exclude=[(NotImplementedError,)] # Don't open circuit for features not implemented in adapter
        )
        self.breaker.add_listener(self._on_breaker_state_change)
        
        logger.info(f"BlockchainServiceManager initialized with Circuit Breaker: fail_max={self.breaker.fail_max}, reset_timeout={self.breaker.reset_timeout}")

    def _on_breaker_state_change(self, breaker, event):
        logger.warning(f"Circuit Breaker state changed to '{breaker.current_state}'")

    async def _execute_with_breaker(self, func, *args, **kwargs):
        """Executes a function through the circuit breaker."""
        try:
            return await self.breaker.call_async(func, *args, **kwargs)
        except CircuitBreakerError as e:
            logger.error(f"Circuit Breaker is open. Attempting fallback for {func.__name__}")
            # Fallback logic: try the same operation with the fallback service
            try:
                fallback_func = getattr(self.fallback_service, func.__name__)
                result = await fallback_func(*args, **kwargs)
                logger.warning(f"Fallback successful for {func.__name__}")
                return result
            except Exception as fallback_error:
                logger.error(f"Fallback also failed for {func.__name__}: {fallback_error}")
                raise BlockchainServiceException(
                    f"Both primary and fallback services failed. Primary: {e}, Fallback: {fallback_error}",
                    code="TOTAL_SERVICE_FAILURE",
                    provider="BlockchainServiceManager"
                ) from e
        except Exception as e:
            logger.error(f"An unexpected error occurred in {func.__name__}: {e}")
            raise

    async def get_swap_quote(self, from_asset: str, to_asset: str, amount: str, user_address: str) -> SwapQuote:
        """Forwards the get_swap_quote call to the active service via circuit breaker."""
        return await self._execute_with_breaker(self.primary_service.get_swap_quote, from_asset, to_asset, amount, user_address)

    async def execute_swap(self, quote_id: str) -> TransactionResult:
        """Forwards the execute_swap call to the active service via circuit breaker."""
        return await self._execute_with_breaker(self.primary_service.execute_swap, quote_id)

    async def get_portfolio(self, user_address: str) -> Dict[str, Any]:
        """Forwards the get_portfolio call to the active service via circuit breaker."""
        return await self._execute_with_breaker(self.primary_service.get_portfolio, user_address)

    async def get_transaction_status(self, tx_hash: str, chain: str) -> Dict[str, Any]:
        """Forwards the get_transaction_status call to the active service via circuit breaker."""
        return await self._execute_with_breaker(self.primary_service.get_transaction_status, tx_hash, chain)

    async def get_bridge_quote(self, asset: str, amount: str, from_chain: str, to_chain: str, sca_address: str) -> Dict[str, Any]:
        """Forwards the get_bridge_quote call to the active service via circuit breaker."""
        return await self._execute_with_breaker(self.primary_service.get_bridge_quote, asset, amount, from_chain, to_chain, sca_address)

    async def execute_bridge(self, quote_id: str, user_signature: str, sca_address: str) -> Dict[str, Any]:
        """Forwards the execute_bridge call to the active service via circuit breaker."""
        return await self._execute_with_breaker(self.primary_service.execute_bridge, quote_id, user_signature, sca_address)

    async def get_supported_assets(self, chain: str) -> List[Dict[str, Any]]:
        """Forwards the get_supported_assets call to the active service via circuit breaker."""
        return await self._execute_with_breaker(self.primary_service.get_supported_assets, chain)

    async def estimate_gas(self, operation: str, params: Dict[str, Any], chain: str) -> Dict[str, Any]:
        """Forwards the estimate_gas call to the active service via circuit breaker."""
        return await self._execute_with_breaker(self.primary_service.estimate_gas, operation, params, chain)

    async def health_check(self) -> Dict[str, Any]:
        """Check health of both primary and fallback services"""
        try:
            primary_health = await self.primary_service.health_check()
            primary_healthy = primary_health.get("status") == "healthy"
        except Exception as e:
            logger.error(f"Primary service health check failed: {e}")
            primary_health = {"status": "unhealthy", "error": str(e)}
            primary_healthy = False
        
        try:
            fallback_health = await self.fallback_service.health_check()
            fallback_healthy = fallback_health.get("status") == "healthy"
        except Exception as e:
            logger.error(f"Fallback service health check failed: {e}")
            fallback_health = {"status": "unhealthy", "error": str(e)}
            fallback_healthy = False
        
        overall_status = "healthy" if primary_healthy or fallback_healthy else "unhealthy"
        
        return {
            "status": overall_status,
            "manager": "BlockchainServiceManager",
            "circuit_breaker_state": self.breaker.current_state,
            "primary_service": primary_health,
            "fallback_service": fallback_health,
            "failover_available": fallback_healthy,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

    async def predict_sca_address(self, owner_address: str) -> str:
        """Forwards the predict_sca_address call to the active service via circuit breaker."""
        return await self._execute_with_breaker(self.primary_service.predict_sca_address, owner_address=owner_address)

    async def get_staking_quote(
        self,
        asset: str,
        amount: str,
        staking_pool: str,
        from_chain: str,
        sca_address: str
    ):
        """Forwards the get_staking_quote call to the active service via circuit breaker."""
        return await self._execute_with_breaker(
            self.primary_service.get_staking_quote, 
            asset, amount, staking_pool, from_chain, sca_address
        )

    async def execute_staking(
        self,
        quote_id: str,
        user_signature: str,
        sca_address: str
    ):
        """Forwards the execute_staking call to the active service via circuit breaker."""
        return await self._execute_with_breaker(
            self.primary_service.execute_staking,
            quote_id, user_signature, sca_address
        )

    async def get_lending_quote(
        self,
        asset: str,
        amount: str,
        lending_pool: str,
        from_chain: str,
        sca_address: str
    ):
        """Forwards the get_lending_quote call to the active service via circuit breaker."""
        return await self._execute_with_breaker(
            self.primary_service.get_lending_quote,
            asset, amount, lending_pool, from_chain, sca_address
        )

    async def execute_supply(
        self,
        quote_id: str,
        user_signature: str,
        sca_address: str
    ):
        """Forwards the execute_supply call to the active service via circuit breaker."""
        return await self._execute_with_breaker(
            self.primary_service.execute_supply,
            quote_id, user_signature, sca_address
        )

    async def get_onchain_data(self, source: str, chain: str):
        """Forwards the get_onchain_data call to the active service via circuit breaker."""
        return await self._execute_with_breaker(
            self.primary_service.get_onchain_data,
            source, chain
        )

    async def register_workflow(
        self,
        workflow_id: int,
        trigger_source: str,
        trigger_type: int,
        trigger_target_value: int,
        commitment_hash: bytes
    ) -> TransactionResult:
        """
        Registers a workflow on-chain.
        This operation is not supported by OneBalance, so it calls the
        fallback adapter directly.
        """
        logger.info(f"Manager received request to register workflow {workflow_id}, using fallback adapter directly.")
        try:
            return await self.fallback_service.register_workflow(
                workflow_id=workflow_id,
                trigger_source=trigger_source,
                trigger_type=trigger_type,
                trigger_target_value=trigger_target_value,
                commitment_hash=commitment_hash
            )
        except Exception as e:
            logger.error(f"Fallback adapter failed to register workflow {workflow_id}: {e}")
            raise BlockchainServiceException(
                f"DirectWeb3Adapter failed during workflow registration: {e}",
                code="FALLBACK_REGISTRATION_FAILURE",
                provider="BlockchainServiceManager"
            ) from e


# Singleton instance of the manager to be used across the application
blockchain_manager = BlockchainServiceManager()

def get_blockchain_service() -> BlockchainServiceInterface:
    """Dependency function to get the blockchain service manager"""
    return blockchain_manager 