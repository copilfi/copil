from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Union
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status, FastAPI
from fastapi.security import HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.config import settings
from app.core.database import get_db
from app.models.user import User

# --- Configuration ---
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer()
ALGORITHM = "HS256" # Algorithm for our internal JWTs

# --- Password Utilities ---
def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plain password against a hashed one."""
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    """Hashes a plain password."""
    return pwd_context.hash(password)

# --- Internal Token Creation ---
def create_access_token(subject: str, expires_delta: Optional[timedelta] = None) -> str:
    """Creates a new access token for our application."""
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode = {"exp": expire, "sub": str(subject)}
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def create_refresh_token(subject: Union[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Creates a new refresh token for our application."""
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode = {"exp": expire, "sub": str(subject)}
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

# --- Token Verification for Internal JWTs ---
def verify_access_token(token: str, credentials_exception: HTTPException) -> dict:
    """
    Decodes and verifies the internal access token.
    """
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired", headers={"WWW-Authenticate": "Bearer"})
    except jwt.JWTError:
        raise credentials_exception

# --- Privy Token Verification ---
class PrivyTokenVerifier:
    """Verifies JWTs issued by Privy."""
    
    @staticmethod
    def verify_token(token: str) -> Dict[str, Any]:
        """
        Verifies the signature and claims of a Privy token.
        Uses the public key from settings.
        """
        if not settings.PRIVY_VERIFICATION_KEY or not settings.PRIVY_APP_ID:
            raise HTTPException(status_code=500, detail="Privy settings are not configured on the server.")
        
        try:
            # Privy uses the ES256 algorithm for its tokens.
            decoded_token = jwt.decode(
                token,
                settings.PRIVY_VERIFICATION_KEY,
                algorithms=["ES256"],
                audience=settings.PRIVY_APP_ID,
                issuer="privy.io"
            )
            return decoded_token
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Your session has expired. Please log in again.")
        except jwt.InvalidAudienceError:
            raise HTTPException(status_code=401, detail="Token audience is invalid. Check server configuration.")
        except Exception as e:
            raise HTTPException(status_code=401, detail=f"Could not validate Privy token: {str(e)}")

# --- FastAPI Dependencies for Protected Routes ---
async def get_current_user(
    token: HTTPBearer = Depends(bearer_scheme), 
    db: AsyncSession = Depends(get_db)
) -> User:
    """
    Decodes our internal access token, validates its signature, 
    and retrieves the user from the database.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token.credentials, settings.SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()

    if user is None:
        raise credentials_exception
    return user

async def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """
    Takes the user retrieved from the token and checks if they are active.
    This is the primary dependency for most protected endpoints.
    """
    if not current_user.is_active:
        raise HTTPException(status_code=403, detail="User is inactive")
    return current_user


def setup_security_middleware(app: FastAPI):
    """Setup security middleware for the FastAPI app"""
    # Add any security middleware here if needed
    # For now, we'll use the existing CORS and TrustedHost middleware from main.py
    pass 