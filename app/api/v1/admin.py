from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict, Any
from datetime import datetime

from app.services.blockchain.manager import get_blockchain_service
from app.services.blockchain.base import BlockchainServiceInterface
from app.core.security import get_current_active_user # Bu daha sonra kullanılacak
from app.models.user import User

router = APIRouter()

def get_blockchain_manager() -> BlockchainServiceInterface:
    return get_blockchain_service()

@router.get("/health-check", tags=["Admin"], summary="Perform a health check on external services")
async def health_check(
    blockchain: BlockchainServiceInterface = Depends(get_blockchain_manager)
):
    """
    Checks the status of connected external services like OneBalance.
    """
    try:
        health_status = await blockchain.health_check()
        if health_status.get("status") != "ok":
            raise HTTPException(
                status_code=503,
                detail=health_status
            )
        return health_status
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/supported-assets", tags=["Admin"], summary="Get list of supported assets from OneBalance")
async def get_supported_assets(
    chain: str = None, # Optional chain filter
    blockchain: BlockchainServiceInterface = Depends(get_blockchain_manager)
) -> List[Dict[str, Any]]:
    """
    Retrieves a list of all assets supported by the OneBalance platform.
    An optional 'chain' query parameter can be used to filter assets by a specific blockchain.
    """
    try:
        assets = await blockchain.get_supported_assets(chain=chain)
        return assets
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch supported assets: {str(e)}")

@router.get("/test-onebalance/{address}", tags=["Admin"], summary="Test OneBalance API with real address")
async def test_onebalance_api(
    address: str,
    blockchain: BlockchainServiceInterface = Depends(get_blockchain_manager)
):
    """
    Test OneBalance API functionality with a real Ethereum address.
    """
    try:
        # Test portfolio fetch
        portfolio = await blockchain.get_portfolio(address)
        
        return {
            "address": address,
            "portfolio": portfolio,
            "provider": portfolio.provider if portfolio else "unknown",
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OneBalance API test failed: {str(e)}")

# Admin-only endpoints will be defined here
# e.g., /users, /system-health 