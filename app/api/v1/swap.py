# backend/app/api/v1/swap.py
from fastapi import APIRouter, Depends, HTTPException
from app.core.security import get_current_active_user
from app.models.user import User
from app.services.blockchain.manager import get_blockchain_service
from app.services.blockchain.base import BlockchainServiceInterface, SwapQuote, TransactionResult, BlockchainServiceException
from app.schemas.swap import SwapQuoteRequest, SwapExecuteRequest

router = APIRouter()

@router.post("/quote", response_model=SwapQuote, summary="Get a swap quote")
async def get_swap_quote(
    request: SwapQuoteRequest,
    user: User = Depends(get_current_active_user),
    blockchain: BlockchainServiceInterface = Depends(get_blockchain_service)
):
    """
    Provides a quote for swapping one asset for another.
    This is the first step in the swap process.
    """
    try:
        user_address = user.sca_address or user.wallet_address
        if not user_address:
            raise HTTPException(status_code=404, detail="User has no associated wallet address.")

        quote = await blockchain.get_swap_quote(
            from_asset=request.from_asset,
            to_asset=request.to_asset,
            amount=request.amount,
            from_chain=request.from_chain,
            to_chain=request.to_chain,
            sca_address=user_address,
            slippage=request.slippage
        )
        return quote
    except BlockchainServiceException as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred: {str(e)}")

@router.post("/execute", response_model=TransactionResult, summary="Execute a swap")
async def execute_swap(
    request: SwapExecuteRequest,
    user: User = Depends(get_current_active_user),
    blockchain: BlockchainServiceInterface = Depends(get_blockchain_service)
):
    """
    Executes a previously generated swap quote.
    This is the final step and initiates the on-chain transaction.
    """
    try:
        user_address = user.sca_address or user.wallet_address
        if not user_address:
            raise HTTPException(status_code=404, detail="User has no associated wallet address.")
            
        result = await blockchain.execute_swap(
            quote_id=request.quote_id,
            user_signature=request.user_signature,
            sca_address=user_address
        )
        return result
    except BlockchainServiceException as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred: {str(e)}") 