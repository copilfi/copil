from pydantic import BaseModel, Field
from typing import Optional

class SwapQuoteRequest(BaseModel):
    """
    Schema for requesting a swap quote.
    This model defines the data structure the client must send to get a quote.
    """
    from_asset: str = Field(..., description="The asset to swap from (e.g., 'ETH.ETH').")
    to_asset: str = Field(..., description="The asset to swap to (e.g., 'AVAX.USDC').")
    amount: str = Field(..., description="The amount of the 'from_asset' to swap, in its smallest unit (e.g., wei).")
    from_chain: str = Field(..., description="The source chain ID (e.g., 'eip155:1' for Ethereum).")
    to_chain: str = Field(..., description="The destination chain ID (e.g., 'eip155:43114' for Avalanche).")
    slippage: Optional[float] = Field(0.5, ge=0, le=50, description="The acceptable slippage percentage (e.g., 0.5 for 0.5%).")

    class Config:
        json_schema_extra = {
            "example": {
                "from_asset": "eip155:1/slip44:60",
                "to_asset": "eip155:43114/slip44:60",
                "amount": "1000000000000000000", # 1 ETH in wei
                "from_chain": "eip155:1",
                "to_chain": "eip155:43114",
                "slippage": 0.5
            }
        }

class SwapExecuteRequest(BaseModel):
    """
    Schema for executing a previously obtained swap quote.
    """
    quote_id: str = Field(..., description="The unique identifier of the quote to be executed.")
    user_signature: Optional[str] = Field(None, description="The user's signature authorizing the transaction (if required).")

    class Config:
        json_schema_extra = {
            "example": {
                "quote_id": "some_unique_quote_id_from_onebalance",
                "user_signature": "0x123abc..."
            }
        } 