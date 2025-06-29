import httpx
import logging
from typing import List, Dict

from fastapi import HTTPException

from app.core.config import settings
from app.services.market.base import MarketServiceInterface, TokenPrice, TrendingToken

logger = logging.getLogger(__name__)

COINGECKO_API_URL = "https://pro-api.coingecko.com/api/v3" if settings.COINGECKO_API_KEY else "https://api.coingecko.com/api/v3"

# A basic mapping to handle common symbols. A more robust solution would use a dedicated service or database.
SYMBOL_TO_ID_MAP: Dict[str, str] = {
    "eth": "ethereum",
    "btc": "bitcoin",
    "avax": "avalanche-2", # Note: This is the native token ID, not the platform ID
    "wbtc": "wrapped-bitcoin",
    "usdc": "usd-coin",
    "usdt": "tether",
    "sol": "solana",
    "matic": "matic-network",
}

# Mapping our internal chain names to CoinGecko's asset_platform IDs
CHAIN_TO_ASSET_PLATFORM_ID_MAP: Dict[str, str] = {
    "ethereum": "ethereum",
    "avalanche": "avalanche",
    "base": "base",
    "polygon": "polygon-pos",
    "arbitrum": "arbitrum-one",
}


class CoinGeckoMarketService(MarketServiceInterface):
    """
    Market data service implementation using CoinGecko's API.
    """

    async def get_price(self, asset_symbol: str) -> TokenPrice:
        # Use the mapping to get the correct CoinGecko ID
        asset_id = SYMBOL_TO_ID_MAP.get(asset_symbol.lower(), asset_symbol.lower())

        headers = {}
        if settings.COINGECKO_API_KEY:
            headers['x-cg-pro-api-key'] = settings.COINGECKO_API_KEY

        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    f"{COINGECKO_API_URL}/simple/price?ids={asset_id}&vs_currencies=usd",
                    headers=headers
                )
                response.raise_for_status()
                data = response.json()
                
                if asset_id not in data or 'usd' not in data[asset_id]:
                    raise KeyError(f"Price data not found for asset ID '{asset_id}' in CoinGecko response.")

                price = data[asset_id]['usd']
                return TokenPrice(asset=asset_symbol, price=price, source="coingecko")
            except httpx.HTTPStatusError as e:
                logger.error(f"CoinGecko price fetch failed for {asset_symbol} with status {e.response.status_code}: {e.response.text}")
                if e.response.status_code == 404:
                    raise HTTPException(status_code=404, detail=f"Asset '{asset_symbol}' not found on CoinGecko.")
                raise HTTPException(status_code=503, detail="CoinGecko API is currently unavailable.")
            except (KeyError, IndexError) as e:
                logger.error(f"CoinGecko price response parsing failed for {asset_symbol}: {e}")
                raise HTTPException(status_code=404, detail=f"Could not find price for asset '{asset_symbol}'.")

    async def get_trending_tokens(self, chain: str = "avalanche") -> List[TrendingToken]:
        """
        Fetches top 10 tokens by market cap for a given chain as a proxy for "trending".
        """
        asset_platform_id = CHAIN_TO_ASSET_PLATFORM_ID_MAP.get(chain.lower())
        if not asset_platform_id:
            raise HTTPException(status_code=400, detail=f"Unsupported chain '{chain}'. Valid chains are: {list(CHAIN_TO_ASSET_PLATFORM_ID_MAP.keys())}")

        headers = {}
        if settings.COINGECKO_API_KEY:
            headers['x-cg-pro-api-key'] = settings.COINGECKO_API_KEY

        async with httpx.AsyncClient() as client:
            try:
                # Fetches top 10 tokens by market cap on the specified chain
                response = await client.get(
                    f"{COINGECKO_API_URL}/coins/markets",
                    params={
                        "vs_currency": "usd",
                        "asset_platform": asset_platform_id,
                        "order": "market_cap_desc",
                        "per_page": 10,
                        "page": 1,
                        "sparkline": "false"
                    },
                    headers=headers
                )
                response.raise_for_status()
                data = response.json()
                
                return [
                    TrendingToken(
                        id=item.get('id', 'N/A'),
                        symbol=item.get('symbol', 'N/A'),
                        name=item.get('name', 'N/A'),
                        price_change_percentage_24h=item.get('price_change_percentage_24h', 0)
                    ) for item in data
                ]
            except httpx.HTTPStatusError as e:
                logger.error(f"CoinGecko trending fetch for chain '{chain}' failed: {e}")
                raise HTTPException(status_code=503, detail="CoinGecko API is currently unavailable.")
            except Exception as e:
                logger.error(f"An unexpected error occurred while fetching trending tokens for chain '{chain}': {e}")
                raise HTTPException(status_code=500, detail="An internal error occurred.") 