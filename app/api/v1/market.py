from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional

from app.services.market.manager import market_manager
from app.services.market.base import TokenPrice, TrendingToken

router = APIRouter()

# Market data endpoints will be defined here
# e.g., /prices, /trending 

@router.get(
    "/price/{asset_symbol}",
    response_model=TokenPrice,
    summary="Get Asset Price"
)
async def get_asset_price(asset_symbol: str):
    """
    Fetches the current price of a specified asset.
    It prioritizes Chainlink for accuracy and falls back to CoinGecko.
    """
    try:
        return await market_manager.get_price(asset_symbol)
    except Exception as e:
        # The service layer should raise specific HTTPExceptions.
        # This is a fallback.
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(
            status_code=404,
            detail=f"Could not fetch price for asset '{asset_symbol}': {e}"
        )

@router.get(
    "/trending",
    response_model=List[TrendingToken],
    summary="Get Trending Tokens"
)
async def get_trending_tokens_list(
    chain: Optional[str] = Query("avalanche", description="The blockchain to query for trending tokens. E.g., 'avalanche', 'ethereum', 'base'.")
):
    """
    Fetches a list of trending tokens for a given blockchain, 
    currently sourced from CoinGecko based on market capitalization.
    """
    try:
        return await market_manager.get_trending_tokens(chain=chain)
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch trending tokens: {e}"
        ) 