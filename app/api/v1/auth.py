from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Any

from app.core.database import get_db
from app.services.user_service import user_service
from app.core.security import PrivyTokenVerifier, create_access_token, create_refresh_token
from app.schemas.auth import TokenResponse

router = APIRouter()

# Authentication endpoints will be defined here
# e.g., /login, /register, /logout 

@router.post("/login/privy", response_model=TokenResponse, summary="Authenticate via Privy")
async def login_with_privy(
    privy_token: str = Body(..., embed=True, description="The access token from Privy."),
    db: AsyncSession = Depends(get_db)
) -> Any:
    """
    Handles the primary authentication flow using a Privy token.

    - Verifies the Privy token.
    - Gets or creates a user in the local database.
    - Creates and returns internal access and refresh tokens.
    """
    try:
        # Use the centralized verifier from our security module
        privy_claims = PrivyTokenVerifier.verify_token(privy_token)
        
        user = await user_service.get_or_create_from_privy(db=db, privy_claims=privy_claims)

        if not user or not user.is_active:
            raise HTTPException(status_code=403, detail="User is inactive or could not be processed.")

        # Create our internal tokens for the user
        access_token = create_access_token(subject=user.id)
        refresh_token = create_refresh_token(subject=user.id)
        
        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer"
        }

    except HTTPException as e:
        # Re-raise HTTPExceptions to preserve status code and details
        raise e
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"An unexpected error occurred during login: {str(e)}"
        ) 