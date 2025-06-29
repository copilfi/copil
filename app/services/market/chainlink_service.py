import logging
from web3 import Web3
from typing import List

from app.core.config import settings
from app.services.market.base import MarketServiceInterface, TokenPrice, TrendingToken
from app.services.market.chainlink_abi import CHAINLINK_AGGREGATOR_ABI

logger = logging.getLogger(__name__)

# A mapping of asset symbols to their Chainlink Price Feed addresses on a specific network.
# This example uses Avalanche Mainnet. This map should be expanded.
AVALANCHE_PRICE_FEEDS = {
    "AVAX": "0x0A77230d17318075983913bC2145DB16C7366156",
    "BTC": "0x2779D32d5166BAaa2B2b658333bA7e6Ec0C65743",
    "ETH": "0x976B3D034E162d8bD72D6b9C989d545b839003b0",
    "USDC": "0xF096872672F44d6EBA71458D74fe67F9a77a23B9",
}

class ChainlinkPriceService(MarketServiceInterface):
    """
    Market data service to fetch prices from Chainlink Data Feeds.
    """
    def __init__(self):
        if not settings.AVALANCHE_RPC_URL:
            raise ValueError("Avalanche RPC URL is not configured.")
        self.w3 = Web3(Web3.HTTPProvider(settings.AVALANCHE_RPC_URL))
        if not self.w3.is_connected():
            raise ConnectionError("Failed to connect to Avalanche RPC.")

    async def get_price(self, asset_symbol: str) -> TokenPrice:
        asset_symbol_upper = asset_symbol.upper()
        if asset_symbol_upper not in AVALANCHE_PRICE_FEEDS:
            raise ValueError(f"No Chainlink price feed found for {asset_symbol} on Avalanche.")
        
        contract_address = AVALANCHE_PRICE_FEEDS[asset_symbol_upper]
        contract = self.w3.eth.contract(address=Web3.to_checksum_address(contract_address), abi=CHAINLINK_AGGREGATOR_ABI)
        
        try:
            latest_round_data = contract.functions.latestRoundData().call()
            # The price is in the second position of the tuple, and we need to adjust for decimals.
            decimals = contract.functions.decimals().call()
            price = latest_round_data[1] / (10 ** decimals)
            return TokenPrice(asset=asset_symbol, price=price, source="chainlink")
        except Exception as e:
            logger.error(f"Chainlink price fetch failed for {asset_symbol}: {e}")
            raise Exception("Could not fetch price from Chainlink.")

    async def get_trending_tokens(self) -> List[TrendingToken]:
        logger.warning("get_trending_tokens is not supported by ChainlinkPriceService.")
        raise NotImplementedError("Chainlink does not provide trending token data.") 