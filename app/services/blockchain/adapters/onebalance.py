# backend/app/services/blockchain/adapters/onebalance.py
from typing import Dict, Any, List, Optional
import uuid
import time
import random

from app.services.blockchain.base import (
    BlockchainServiceInterface, 
    SwapQuote, 
    TransactionResult, 
    PortfolioBalance, 
    TransactionStatus,
    BridgeQuote,
    BlockchainServiceException,
    NetworkException,
    UnsupportedAssetException,
    StakingQuote,
    LendingQuote,
    OnchainData
)
from app.core.config import settings
# from onebalance.client import OneBalanceClient # Gerçek SDK entegrasyonu için
import httpx


class OneBalanceAdapter(BlockchainServiceInterface):
    """
    Primary blockchain service adapter using OneBalance API.
    This adapter translates our internal service calls into OneBalance API requests.
    """

    def __init__(self, api_key: str = settings.ONEBALANCE_API_KEY):
        if not api_key:
            raise ValueError("OneBalance API key is not configured.")
        
        self.api_key = api_key
        # Ensure base_url ends with a slash for proper joining
        self.base_url = settings.ONEBALANCE_API_URL.rstrip('/') + '/'
        
        self.client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={
                "x-api-key": self.api_key,
                "Content-Type": "application/json"
            },
            timeout=30.0 # Set a reasonable timeout
        )
        self.provider_name = "onebalance"

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
        """Fetches a swap quote from the OneBalance API."""
        if settings.MOCK_EXTERNAL_APIS:
            return self._get_mock_swap_quote(from_asset, to_asset, amount, from_chain, to_chain)
        
        try:
            request_body = {
                "fromAsset": from_asset,
                "toAsset": to_asset,
                "fromAmount": amount,
                "fromChain": from_chain,
                "toChain": to_chain,
                "user": sca_address,
                "slippage": slippage
            }
            # Assuming the endpoint is 'quote' based on common API design
            response = await self.client.post("v1/quote", json=request_body)
            response.raise_for_status()
            data = response.json()
            
            # Map OneBalance response to our internal SwapQuote dataclass
            return SwapQuote(
                quote_id=data.get("quoteId"),
                from_asset=data.get("fromAsset"),
                to_asset=data.get("toAsset"),
                from_amount=data.get("fromAmount"),
                to_amount=data.get("toAmount"),
                from_chain=data.get("fromChain"),
                to_chain=data.get("toChain"),
                route=data.get("route", []),
                estimated_gas=data.get("estimatedGas"),
                gas_price_gwei=data.get("gasPriceGwei"),
                slippage=data.get("slippage"),
                expires_at=data.get("expiresAt"),
                provider=self.provider_name
            )
        except httpx.HTTPStatusError as e:
            raise BlockchainServiceException(f"OneBalance API error getting quote: {e.response.text}", code=e.response.status_code, provider=self.provider_name)
        except httpx.RequestError as e:
            raise NetworkException(f"Network error contacting OneBalance for quote: {e}", provider=self.provider_name)

    async def execute_swap(
        self,
        quote_id: str,
        user_signature: str,
        sca_address: str
    ) -> TransactionResult:
        """Executes a swap using a previously obtained quote."""
        if settings.MOCK_EXTERNAL_APIS:
            return self._get_mock_tx_result()

        try:
            request_body = {
                "quoteId": quote_id,
                "userSignature": user_signature,
                "user": sca_address
            }
            # Assuming the endpoint is 'execute'
            response = await self.client.post("v1/execute", json=request_body)
            response.raise_for_status()
            data = response.json()
            
            return TransactionResult(
                transaction_hash=data.get("transactionHash"),
                status=TransactionStatus(data.get("status", "pending").lower()),
                provider=self.provider_name
            )
        except httpx.HTTPStatusError as e:
            raise BlockchainServiceException(f"OneBalance API error executing swap: {e.response.text}", code=e.response.status_code, provider=self.provider_name)
        except httpx.RequestError as e:
            raise NetworkException(f"Network error contacting OneBalance for swap execution: {e}", provider=self.provider_name)

    async def get_portfolio(
        self,
        address: str,
        chains: Optional[List[str]] = None
    ) -> PortfolioBalance:
        """Fetches the user's multi-chain portfolio from the OneBalance API."""
        if settings.MOCK_EXTERNAL_APIS:
            return self._get_mock_portfolio(address)

        try:
            params = {"address": address}
            if chains:
                params["chains"] = ",".join(chains)
                
            response = await self.client.get("v2/balances/aggregated-balance", params=params)
            response.raise_for_status()
            data = response.json()
            
            # Map the response to our standardized PortfolioBalance dataclass
            # OneBalance response has: 'balanceByAggregatedAsset', 'totalBalance'
            total_balance = data.get("totalBalance", {})
            total_value_usd = str(total_balance.get("fiatValue", 0))
            
            # Convert OneBalance assets to our format
            assets = []
            for balance_data in data.get("balanceByAggregatedAsset", []):
                assets.append({
                    "symbol": balance_data.get("aggregatedAssetId", "").replace("ds:", "").upper(),
                    "balance": balance_data.get("balance", "0"),
                    "fiat_value": balance_data.get("fiatValue", 0)
                })
            
            return PortfolioBalance(
                address=address,
                chain="multi-chain", # OneBalance provides aggregated balances
                assets=assets,
                total_value_usd=total_value_usd,
                provider=self.provider_name,
                last_updated=int(time.time())
            )
        except httpx.HTTPStatusError as e:
            raise BlockchainServiceException(f"Failed to fetch portfolio from OneBalance: {e.response.text}", code=e.response.status_code, provider=self.provider_name)
        except httpx.RequestError as e:
            raise NetworkException(f"Network error while fetching portfolio from OneBalance: {e}", provider=self.provider_name)

    async def get_transaction_status(
        self,
        tx_hash: str,
        chain: str # Chain might be optional if OneBalance can find tx by hash alone
    ) -> TransactionResult:
        """Checks the status of a given transaction hash via OneBalance."""
        if settings.MOCK_EXTERNAL_APIS:
            return self._get_mock_tx_result(tx_hash)

        try:
            # Endpoint assumed to be 'transactions/{tx_hash}'
            response = await self.client.get(f"v1/transactions/{tx_hash}")
            response.raise_for_status()
            data = response.json()
            
            return TransactionResult(
                transaction_hash=data.get("transactionHash", tx_hash),
                status=TransactionStatus(data.get("status", "pending").lower()),
                block_number=data.get("blockNumber"),
                gas_used=data.get("gasUsed"),
                error_message=data.get("errorMessage"),
                provider=self.provider_name
            )
        except httpx.HTTPStatusError as e:
            raise BlockchainServiceException(f"Failed to get transaction status from OneBalance: {e.response.text}", code=e.response.status_code, provider=self.provider_name)
        except httpx.RequestError as e:
            raise NetworkException(f"Network error fetching transaction status: {e}", provider=self.provider_name)

    async def get_supported_assets(self, chain: Optional[str] = None) -> List[Dict[str, Any]]:
        """Gets supported assets, optionally filtered by chain."""
        try:
            # Corrected endpoint based on analysis of the internal server error.
            # The previous endpoint 'v1/assets' was incorrect.
            response = await self.client.get("v2/assets/aggregated-assets-list")
            response.raise_for_status()
            data = response.json()
            # The actual asset list is under the 'assets' key in the response.
            assets = data.get("assets", [])
            
            if chain and assets:
                return [asset for asset in assets if chain.lower() in [c.get('chain').lower() for c in asset.get('chains', [])]]
            
            return assets
        except httpx.HTTPStatusError as e:
            raise BlockchainServiceException(f"Failed to get supported assets: {e.response.text}", code=e.response.status_code, provider=self.provider_name)
        except httpx.RequestError as e:
            raise NetworkException(f"Network error fetching supported assets: {e}", provider=self.provider_name)

    async def health_check(self) -> Dict[str, Any]:
        """Performs a health check on the OneBalance API."""
        try:
            response = await self.client.get("health")
            response.raise_for_status()
            return {"provider": self.provider_name, "status": "ok", "details": response.json()}
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            return {"provider": self.provider_name, "status": "error", "details": str(e)}

    async def predict_sca_address(self, owner_address: str) -> str:
        """Predicts the SCA address for the given owner EOA using the OneBalance API."""
        try:
            # This endpoint was identified from the onebalance-d7e5d4d0 MCP tool.
            # It requires the owner addresses for the session and admin keys.
            # For a simple prediction, we can often use the same address for both.
            request_body = {
                "sessionKeyAddress": owner_address,
                "adminKeyAddress": owner_address
            }
            response = await self.client.post("account/predict-address", json=request_body)
            response.raise_for_status()
            data = response.json()
            
            sca_address = data.get("address")
            if not sca_address:
                raise BlockchainServiceException("OneBalance API did not return a predicted SCA address.", provider=self.provider_name)
                
            return sca_address
        except httpx.HTTPStatusError as e:
            raise BlockchainServiceException(f"Failed to predict SCA address: {e.response.text}", code=e.response.status_code, provider=self.provider_name)
        except httpx.RequestError as e:
            raise NetworkException(f"Network error while predicting SCA address: {e}", provider=self.provider_name)

    # --- Bridge Methods ---
    async def get_bridge_quote(self, asset: str, amount: str, from_chain: str, to_chain: str, sca_address: str) -> BridgeQuote:
        """Fetches a bridge quote from the OneBalance API."""
        if settings.MOCK_EXTERNAL_APIS:
            return self._get_mock_bridge_quote(asset, amount, from_chain, to_chain)

        try:
            # For bridging, fromAsset and toAsset are the same, just on different chains.
            # The OneBalance `quote` endpoint is likely reused for this.
            request_body = {
                "fromAsset": asset,
                "toAsset": asset,
                "fromAmount": amount,
                "fromChain": from_chain,
                "toChain": to_chain,
                "user": sca_address,
                "type": "bridge" # Explicitly specify the type if API supports it
            }
            response = await self.client.post("v1/quote", json=request_body)
            response.raise_for_status()
            data = response.json()
            
            # Map OneBalance response to our internal BridgeQuote dataclass
            return BridgeQuote(
                quote_id=data.get("quoteId"),
                asset=data.get("fromAsset"),
                amount=data.get("fromAmount"),
                from_chain=data.get("fromChain"),
                to_chain=data.get("toChain"),
                estimated_time_minutes=data.get("estimatedTimeMinutes", 5),
                bridge_fee=data.get("bridgeFee"),
                estimated_gas=data.get("estimatedGas"),
                provider=self.provider_name,
                expires_at=data.get("expiresAt")
            )
        except httpx.HTTPStatusError as e:
            raise BlockchainServiceException(f"OneBalance API error getting bridge quote: {e.response.text}", code=e.response.status_code, provider=self.provider_name)
        except httpx.RequestError as e:
            raise NetworkException(f"Network error contacting OneBalance for bridge quote: {e}", provider=self.provider_name)

    async def execute_bridge(self, quote_id: str, user_signature: str, sca_address: str) -> TransactionResult:
        """Executes a bridge using a previously obtained quote."""
        if settings.MOCK_EXTERNAL_APIS:
            return self._get_mock_tx_result()

        try:
            # Reusing the 'execute' endpoint for bridge quotes
            request_body = {
                "quoteId": quote_id,
                "userSignature": user_signature,
                "user": sca_address
            }
            response = await self.client.post("v1/execute", json=request_body)
            response.raise_for_status()
            data = response.json()
            
            return TransactionResult(
                transaction_hash=data.get("transactionHash"),
                status=TransactionStatus(data.get("status", "pending").lower()),
                provider=self.provider_name
            )
        except httpx.HTTPStatusError as e:
            raise BlockchainServiceException(f"OneBalance API error executing bridge: {e.response.text}", code=e.response.status_code, provider=self.provider_name)
        except httpx.RequestError as e:
            raise NetworkException(f"Network error contacting OneBalance for bridge execution: {e}", provider=self.provider_name)
        
    async def get_staking_quote(self, asset: str, amount: str, staking_pool: str, from_chain: str, sca_address: str) -> StakingQuote:
        """
        Gets a staking quote.
        This would likely use a generic 'contract call' quote endpoint from OneBalance.
        """
        # For now, we'll return a mock quote if enabled, otherwise raise not implemented.
        if settings.MOCK_EXTERNAL_APIS:
            return self._get_mock_staking_quote(asset, amount, staking_pool, from_chain)
        raise NotImplementedError("Staking quote via OneBalance is not yet implemented.")

    async def execute_staking(self, quote_id: str, user_signature: str, sca_address: str) -> TransactionResult:
        """Executes a staking transaction."""
        if settings.MOCK_EXTERNAL_APIS:
            return self._get_mock_tx_result()
        raise NotImplementedError("Staking execution via OneBalance is not yet implemented.")

    async def get_lending_quote(self, asset: str, amount: str, lending_pool: str, from_chain: str, sca_address: str) -> LendingQuote:
        """
        Gets a lending supply quote.
        Also likely uses a generic 'contract call' quote endpoint.
        """
        if settings.MOCK_EXTERNAL_APIS:
            return self._get_mock_lending_quote(asset, amount, lending_pool, from_chain)
        raise NotImplementedError("Lending quote via OneBalance is not yet implemented.")

    async def execute_supply(self, quote_id: str, user_signature: str, sca_address: str) -> TransactionResult:
        """Executes a supply transaction for a lending protocol."""
        if settings.MOCK_EXTERNAL_APIS:
            return self._get_mock_tx_result()
        raise NotImplementedError("Lending supply execution via OneBalance is not yet implemented.")

    async def get_onchain_data(self, source: str, chain: str) -> OnchainData:
        """Fetches generic on-chain data, like a price feed."""
        if settings.MOCK_EXTERNAL_APIS:
            return self._get_mock_onchain_data(source, chain)
        # This would require a specific OneBalance endpoint for reading contract data
        # or integrating with oracles, which is not assumed to exist yet.
        raise NotImplementedError("Fetching generic on-chain data is not yet implemented.")

    async def estimate_gas(self, operation: str, params: Dict[str, Any], chain: str) -> Dict[str, Any]:
        raise NotImplementedError("Custom gas estimation is not directly supported via OneBalance adapter.")

    # --- Mock Methods for testing when MOCK_EXTERNAL_APIS=True ---
    def _get_mock_swap_quote(self, from_asset, to_asset, amount, from_chain, to_chain) -> SwapQuote:
        return SwapQuote(
            quote_id=f"mock_quote_{uuid.uuid4()}",
            from_asset=from_asset,
            to_asset=to_asset,
            from_amount=amount,
            to_amount=str(float(amount) * 1.5), # Dummy conversion
            from_chain=from_chain,
            to_chain=to_chain,
            route=[{"provider": "mock_dex", "path": [from_asset, to_asset]}],
            estimated_gas="50000",
            gas_price_gwei="20",
            slippage=0.5,
            expires_at=int(time.time()) + 300,
            provider=self.provider_name + "_mock"
        )
        
    def _get_mock_tx_result(self, tx_hash: Optional[str] = None) -> TransactionResult:
        return TransactionResult(
            transaction_hash=tx_hash or f"0x{uuid.uuid4().hex}",
            status=TransactionStatus.CONFIRMED,
            provider=self.provider_name
        )

    def _get_mock_portfolio(self, address: str) -> PortfolioBalance:
        return PortfolioBalance(
            address=address,
            chain="multi-chain",
            assets=[
                {
                    "name": "Ethereum", "symbol": "ETH", "amount": "2.5", "value_usd": "7500.00"
                },
                {
                    "name": "USD Coin", "symbol": "USDC", "amount": "500.00", "value_usd": "500.00"
                }
            ],
            total_value_usd="8000.00",
            provider=self.provider_name + "_mock",
            last_updated=int(time.time())
        )

    def _get_mock_bridge_quote(self, asset: str, amount: str, from_chain: str, to_chain: str) -> BridgeQuote:
        """Returns a mock bridge quote for testing."""
        return BridgeQuote(
            quote_id=f"mock_bridge_quote_{uuid.uuid4()}",
            asset=asset,
            amount=amount,
            from_chain=from_chain,
            to_chain=to_chain,
            estimated_time_minutes=5,
            bridge_fee="10000000000000000", # 0.01 ETH/MATIC etc.
            estimated_gas="21000",
            provider="mock",
            expires_at=int(time.time()) + 300
        )

    def _get_mock_staking_quote(self, asset: str, amount: str, staking_pool: str, from_chain: str) -> StakingQuote:
        """Returns a mock staking quote for testing."""
        return StakingQuote(
            quote_id=f"mock_stake_quote_{uuid.uuid4()}",
            asset_to_stake=asset,
            amount=amount,
            staking_pool_address=staking_pool,
            apy_percentage=5.5,
            lockup_period_days=0, # e.g. for liquid staking
            provider="mock",
            estimated_gas="50000",
            expires_at=int(time.time()) + 300
        )

    def _get_mock_lending_quote(self, asset: str, amount: str, lending_pool: str, from_chain: str) -> LendingQuote:
        """Returns a mock lending supply quote for testing."""
        return LendingQuote(
            quote_id=f"mock_lending_quote_{uuid.uuid4()}",
            asset_to_supply=asset,
            amount=amount,
            lending_pool_address=lending_pool,
            apy_percentage=2.1,
            provider="mock",
            estimated_gas="75000",
            expires_at=int(time.time()) + 300
        )

    def _get_mock_onchain_data(self, source: str, chain: str) -> OnchainData:
        """Returns mock on-chain data for testing condition nodes."""
        value = None
        if source.startswith("price_feed:"):
            # e.g., "price_feed:MATIC-USD" -> return a mock price
            value = round(random.uniform(0.5, 2.5), 4)

        if value is None:
            raise ValueError(f"Mocking for source '{source}' is not supported.")

        return OnchainData(
            source=source,
            chain=chain,
            value=value,
            provider="mock",
            retrieved_at=int(time.time())
        ) 