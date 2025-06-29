from abc import ABC, abstractmethod
from pydantic import BaseModel
from typing import List

class TokenPrice(BaseModel):
    asset: str
    price: float
    source: str # e.g., "chainlink" or "coingecko"

class TrendingToken(BaseModel):
    id: str
    symbol: str
    name: str
    price_change_percentage_24h: float

class MarketServiceInterface(ABC):
    """
    Abstract base class for market data services.
    """

    @abstractmethod
    async def get_price(self, asset_symbol: str) -> TokenPrice:
        """
        Fetches the current price of a single asset.
        """
        pass

    @abstractmethod
    async def get_trending_tokens(self) -> List[TrendingToken]:
        """
        Fetches a list of trending tokens.
        """
        pass 