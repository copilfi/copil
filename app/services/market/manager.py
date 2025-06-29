import logging
from typing import List

from app.services.market.base import TokenPrice, TrendingToken
from app.services.market.chainlink_service import ChainlinkPriceService
from app.services.market.coingecko_service import CoinGeckoMarketService

logger = logging.getLogger(__name__)

class MarketManager:
    """
    Manages market data services using a hybrid approach.
    - Uses Chainlink for primary, high-reliability price data.
    - Uses CoinGecko for broader market data (trending) and as a price fallback.
    """
    def __init__(self):
        try:
            self.chainlink_service = ChainlinkPriceService()
        except (ValueError, ConnectionError) as e:
            logger.warning(f"Could not initialize ChainlinkPriceService: {e}. Price data will rely solely on CoinGecko.")
            self.chainlink_service = None
        
        self.coingecko_service = CoinGeckoMarketService()

    async def get_price(self, asset_symbol: str) -> TokenPrice:
        """
        Fetches the price of an asset, prioritizing Chainlink.
        """
        # Try Chainlink first
        if self.chainlink_service:
            try:
                price_data = await self.chainlink_service.get_price(asset_symbol)
                logger.info(f"Fetched {asset_symbol} price from Chainlink.")
                return price_data
            except Exception as e:
                logger.warning(f"Chainlink failed for {asset_symbol}: {e}. Falling back to CoinGecko.")
        
        # Fallback to CoinGecko
        logger.info(f"Fetching {asset_symbol} price from CoinGecko (fallback).")
        return await self.coingecko_service.get_price(asset_symbol)

    async def get_trending_tokens(self, chain: str) -> List[TrendingToken]:
        """
        Fetches trending tokens from CoinGecko for a specific chain.
        """
        logger.info(f"Fetching trending tokens for chain '{chain}' from CoinGecko.")
        return await self.coingecko_service.get_trending_tokens(chain=chain)

# Create a single instance to be used across the application
market_manager = MarketManager() 