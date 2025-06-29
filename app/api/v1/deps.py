import logging
import uuid
from typing import Optional

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.models.user import User
from app.core.security import verify_access_token

logger = logging.getLogger(__name__)

reusable_oauth2 = HTTPBearer(scheme_name="Bearer")

async def get_current_user(
    session: AsyncSession = Depends(get_db_session),
    token: HTTPAuthorizationCredentials = Depends(reusable_oauth2)
) -> User:
    """
    FastAPI dependency to get the current user from the internal JWT access token.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    payload = verify_access_token(token.credentials, credentials_exception)
    user_id = payload.get("sub")
    
    user = await session.get(User, uuid.UUID(user_id))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user

async def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """
    FastAPI dependency that checks if the user retrieved from the token is active.
    """
    if not current_user.is_active:
        raise HTTPException(status_code=403, detail="Inactive user")
    return current_user

def get_db() -> Session:
    """
    Sync database session dependency for legacy endpoints
    """
    from app.core.database import SessionLocal
    if not SessionLocal:
        raise RuntimeError("Database not initialized")
    
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_current_user_sync(
    db: Session = Depends(get_db),
    token: HTTPAuthorizationCredentials = Depends(reusable_oauth2)
) -> User:
    """
    Sync version of get_current_user for legacy endpoints
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    payload = verify_access_token(token.credentials, credentials_exception)
    user_id = payload.get("sub")
    
    user = db.get(User, uuid.UUID(user_id))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user 