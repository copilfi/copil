from pydantic import BaseModel, Field
from typing import Optional


class TokenResponse(BaseModel):
    """Token response schema"""
    access_token: str = Field(..., description="JWT access token")
    refresh_token: str = Field(..., description="JWT refresh token")
    token_type: str = Field(default="bearer", description="Token type")


class TokenData(BaseModel):
    """Token data schema for JWT payload"""
    sub: Optional[str] = None
    exp: Optional[int] = None
    iat: Optional[int] = None


class LoginRequest(BaseModel):
    """Login request schema"""
    privy_token: str = Field(..., description="Privy access token")


class RefreshTokenRequest(BaseModel):
    """Refresh token request schema"""
    refresh_token: str = Field(..., description="Refresh token")


class UserProfile(BaseModel):
    """User profile response schema"""
    id: str
    privy_id: str
    wallet_address: Optional[str] = None
    sca_address: Optional[str] = None
    is_active: bool = True
    tier: str = "free"
    
    class Config:
        from_attributes = True 