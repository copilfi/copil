# backend/app/api/v1/portfolio.py
from fastapi import APIRouter, Depends, HTTPException
from typing import Dict, Any, List

from app.services.blockchain.manager import blockchain_manager
from app.services.blockchain.base import BlockchainServiceInterface, PortfolioBalance
from app.core.security import get_current_active_user
from app.models.user import User

router = APIRouter()

# Geçici olarak, blockchain yöneticisini doğrudan bir bağımlılık olarak kullanıyoruz.
# Daha sonra bunu FastAPI'nin dependency injection sistemiyle daha şık hale getirebiliriz.
def get_blockchain_manager() -> BlockchainServiceInterface:
    return blockchain_manager

@router.get("/", response_model=PortfolioBalance, summary="Get the authenticated user's portfolio")
async def get_user_portfolio(
    user: User = Depends(get_current_active_user), # Use real authentication
    blockchain: BlockchainServiceInterface = Depends(get_blockchain_manager)
):
    """
    Retrieves the connected user's multi-chain portfolio.
    
    This endpoint is now protected and uses the authenticated user's
    wallet address (or SCA address if available) to fetch portfolio data from OneBalance.
    """
    try:
        # The user object is now guaranteed to be the authenticated user.
        # Prioritize the Smart Contract Account (SCA) address as per the PRD.
        user_address = user.sca_address or user.wallet_address
        
        if not user_address:
            raise HTTPException(
                status_code=404,
                detail="Authenticated user does not have a wallet or SCA address associated."
            )
            
        # Fetch data using our OneBalance adapter
        portfolio_data = await blockchain.get_portfolio(address=user_address)
        
        # The data is already in the correct PortfolioBalance format from the adapter
        return portfolio_data
        
    except HTTPException as e:
        # Re-raise HTTPException to avoid shadowing
        raise e
    except Exception as e:
        # More specific exception handling (e.g., for BlockchainServiceException) can be added.
        raise HTTPException(
            status_code=500,
            detail=f"An unexpected error occurred while fetching the portfolio: {str(e)}"
        ) 