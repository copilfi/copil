from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List
from dataclasses import dataclass
from enum import Enum
import uuid
from pydantic import BaseModel


class TransactionStatus(str, Enum):
    """Transaction status enumeration"""
    PENDING = "pending"
    CONFIRMED = "confirmed"
    FAILED = "failed"
    DROPPED = "dropped"
    REPLACED = "replaced"


class SwapQuote(BaseModel):
    """Standardized swap quote format across all providers"""
    quote_id: str
    from_asset: str
    to_asset: str
    from_amount: str
    to_amount: str
    from_chain: str
    to_chain: str
    route: List[Dict[str, Any]]
    estimated_gas: Optional[str]
    gas_price_gwei: Optional[str]
    slippage: float
    expires_at: int
    provider: str
    price_impact: Optional[float] = None
    minimum_received: Optional[str] = None


class TransactionResult(BaseModel):
    """Standardized transaction result format"""
    transaction_hash: str
    status: TransactionStatus
    block_number: Optional[int] = None
    gas_used: Optional[int] = None
    gas_price_gwei: Optional[str] = None
    actual_amount_out: Optional[str] = None
    error_message: Optional[str] = None
    provider: str = "unknown"


class PortfolioBalance(BaseModel):
    """Standardized portfolio balance format"""
    address: str
    chain: str
    assets: List[Dict[str, Any]]
    total_value_usd: str
    provider: str
    last_updated: int


class BridgeQuote(BaseModel):
    """Standardized bridge quote format"""
    quote_id: str
    asset: str
    amount: str
    from_chain: str
    to_chain: str
    estimated_time_minutes: int
    bridge_fee: str
    estimated_gas: str
    provider: str
    expires_at: int


class StakingQuote(BaseModel):
    """Represents a quote for a staking operation."""
    quote_id: str
    asset_to_stake: str
    amount: str
    staking_pool_address: str
    provider: str
    apy_percentage: Optional[float] = None
    lockup_period_days: Optional[int] = None
    estimated_gas: Optional[str] = None
    expires_at: Optional[int] = None


class LendingQuote(BaseModel):
    """Represents a quote for supplying assets to a lending protocol."""
    quote_id: str
    asset_to_supply: str
    amount: str
    lending_pool_address: str
    provider: str
    apy_percentage: Optional[float] = None
    estimated_gas: Optional[str] = None
    expires_at: Optional[int] = None


class OnchainData(BaseModel):
    """Represents a piece of data retrieved from the blockchain."""
    source: str # e.g., "price_feed:MATIC-USD"
    chain: str
    value: Any
    provider: str
    retrieved_at: int


class BlockchainServiceInterface(ABC):
    """Vendor-agnostic blockchain service interface"""
    
    @abstractmethod
    async def get_swap_quote(
        self,
        from_asset: str,
        to_asset: str,
        amount: str,
        from_chain: str,
        to_chain: str,
        sca_address: str,
        slippage: float = 0.5
    ) -> SwapQuote:
        """Get swap quote from provider"""
        pass
    
    @abstractmethod
    async def execute_swap(
        self,
        quote_id: str,
        user_signature: str,
        sca_address: str
    ) -> TransactionResult:
        """Execute swap with user signature"""
        pass
    
    @abstractmethod
    async def get_portfolio(
        self,
        address: str,
        chains: Optional[List[str]] = None
    ) -> PortfolioBalance:
        """Get multi-chain portfolio"""
        pass
    
    @abstractmethod
    async def get_transaction_status(
        self,
        tx_hash: str,
        chain: str
    ) -> TransactionResult:
        """Get transaction status"""
        pass
    
    @abstractmethod
    async def get_bridge_quote(
        self,
        asset: str,
        amount: str,
        from_chain: str,
        to_chain: str,
        sca_address: str
    ) -> BridgeQuote:
        """Get bridge quote"""
        pass
    
    @abstractmethod
    async def execute_bridge(
        self,
        quote_id: str,
        user_signature: str,
        sca_address: str
    ) -> TransactionResult:
        """Execute bridge transaction"""
        pass
    
    @abstractmethod
    async def get_supported_assets(
        self,
        chain: str
    ) -> List[Dict[str, Any]]:
        """Get supported assets for a chain"""
        pass
    
    @abstractmethod
    async def estimate_gas(
        self,
        operation: str,
        params: Dict[str, Any],
        chain: str
    ) -> Dict[str, Any]:
        """Estimate gas for operation"""
        pass
    
    @abstractmethod
    async def health_check(self) -> Dict[str, Any]:
        """Check service health"""
        pass

    @abstractmethod
    async def predict_sca_address(self, owner_address: str) -> str:
        """Predict the Smart Contract Account address for a given owner EOA."""
        pass

    @abstractmethod
    async def get_staking_quote(
        self,
        asset: str,
        amount: str,
        staking_pool: str, # e.g., Lido's stETH contract, or a specific validator
        from_chain: str,
        sca_address: str
    ) -> StakingQuote:
        """Gets a quote for staking an asset."""
        pass

    @abstractmethod
    async def execute_staking(
        self,
        quote_id: str,
        user_signature: str,
        sca_address: str
    ) -> TransactionResult:
        """Executes a staking transaction."""
        pass

    @abstractmethod
    async def get_lending_quote(
        self,
        asset: str,
        amount: str,
        lending_pool: str, # e.g., Aave's aUSDC contract
        from_chain: str,
        sca_address: str
    ) -> LendingQuote:
        """Gets a quote for supplying an asset to a lending protocol."""
        pass

    @abstractmethod
    async def execute_supply(
        self,
        quote_id: str,
        user_signature: str,
        sca_address: str
    ) -> TransactionResult:
        """Executes a supply transaction for a lending protocol."""
        pass

    @abstractmethod
    async def get_onchain_data(self, source: str, chain: str) -> OnchainData:
        """
        Fetches a generic piece of on-chain data, e.g., a token price from an oracle.
        The 'source' string defines what to fetch, e.g., "price_feed:MATIC-USD".
        """
        pass


class BlockchainServiceException(Exception):
    """Custom exception for blockchain service errors"""
    
    def __init__(self, message: str, code: str = None, provider: str = None):
        self.message = message
        self.code = code
        self.provider = provider
        super().__init__(message)


class InsufficientBalanceException(BlockchainServiceException):
    """Exception for insufficient balance errors"""
    pass


class QuoteExpiredException(BlockchainServiceException):
    """Exception for expired quotes"""
    pass


class UnsupportedAssetException(BlockchainServiceException):
    """Exception for unsupported assets"""
    pass


class NetworkException(BlockchainServiceException):
    """Exception for network-related errors"""
    pass


class AuthenticationException(BlockchainServiceException):
    """Exception for authentication errors"""
    pass 