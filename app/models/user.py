from sqlalchemy import Column, String, Boolean, Integer, DateTime, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime, timezone

from app.models.base import BaseModel


class User(BaseModel):
    """User model supporting hybrid authentication (Privy + JWT)"""
    __tablename__ = "users"
    
    # Primary identification
    privy_id = Column(String(255), unique=True, nullable=True, index=True)  # Privy user ID
    email = Column(String(255), nullable=True, index=True)
    
    # Wallet information
    wallet_address = Column(String(42), nullable=True, index=True)  # Primary wallet
    sca_address = Column(String(42), nullable=True, index=True)     # Smart Contract Account
    
    # Subscription and limits
    tier = Column(String(20), default='free', nullable=False)  # free, pro, enterprise
    api_usage_daily = Column(Integer, default=0, nullable=False)
    ai_calls_daily = Column(Integer, default=0, nullable=False)
    cost_spent_daily_usd = Column(String, default='0.0', nullable=False)  # Using string for precise decimal
    
    # Account status
    is_active = Column(Boolean, default=True, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)
    is_premium = Column(Boolean, default=False, nullable=False)
    is_superuser = Column(Boolean, default=False)
    
    # Security fields
    last_login_at = Column(DateTime(timezone=True), nullable=True)
    failed_login_attempts = Column(Integer, default=0, nullable=False)
    account_locked_until = Column(DateTime(timezone=True), nullable=True)
    password_hash = Column(String(255), nullable=True)  # For JWT fallback auth
    
    # User preferences and settings
    settings = Column(JSONB, default=dict, nullable=False)
    notification_preferences = Column(JSONB, default=dict, nullable=False)
    
    # Tracking fields
    last_active_at = Column(DateTime(timezone=True), nullable=True)
    total_workflows_created = Column(Integer, default=0, nullable=False)
    total_workflows_executed = Column(Integer, default=0, nullable=False)
    total_volume_usd = Column(String, default='0.0', nullable=False)
    
    # Referral and marketing
    referral_code = Column(String(20), unique=True, nullable=True, index=True)
    referred_by = Column(String(20), nullable=True)
    
    # Relationships
    workflows = relationship("Workflow", back_populates="user", cascade="all, delete-orphan")
    portfolio_snapshots = relationship("PortfolioSnapshot", back_populates="user", cascade="all, delete-orphan")
    session_key_grants = relationship("SessionKeyGrant", back_populates="user", cascade="all, delete-orphan")
    
    # Indexes for performance
    __table_args__ = (
        Index('idx_user_privy_id', 'privy_id'),
        Index('idx_user_wallet_address', 'wallet_address'),
        Index('idx_user_sca_address', 'sca_address'),
        Index('idx_user_email', 'email'),
        Index('idx_user_tier', 'tier'),
        Index('idx_user_active', 'is_active'),
        Index('idx_user_last_active', 'last_active_at'),
    )
    
    def __repr__(self):
        return f"<User(id={self.id}, email={self.email}, tier={self.tier})>"
    
    @property
    def is_free_tier(self) -> bool:
        """Check if user is on free tier"""
        return self.tier == 'free'
    
    @property
    def is_pro_tier(self) -> bool:
        """Check if user is on pro tier"""
        return self.tier == 'pro'
    
    @property
    def is_enterprise_tier(self) -> bool:
        """Check if user is on enterprise tier"""
        return self.tier == 'enterprise'
    
    @property
    def is_account_locked(self) -> bool:
        """Check if account is currently locked"""
        if not self.account_locked_until:
            return False
        return self.account_locked_until > datetime.now(timezone.utc)
    
    def can_use_ai(self, requested_calls: int = 1) -> bool:
        """Check if user can make AI calls based on tier limits"""
        from app.core.config import settings
        
        if self.is_enterprise_tier:
            return True
        
        tier_limits = settings.get_ai_cost_limit_for_tier(self.tier)
        daily_limit = tier_limits['daily_calls']
        
        if daily_limit == -1:  # Unlimited
            return True
        
        return (self.ai_calls_daily + requested_calls) <= daily_limit
    
    def can_create_workflow(self) -> bool:
        """Check if user can create more workflows based on tier"""
        if self.is_enterprise_tier:
            return True
        
        if self.is_pro_tier:
            return True  # Unlimited for pro
        
        # Free tier limit
        return self.total_workflows_created < 3
    
    def increment_ai_usage(self, calls: int = 1, cost_usd: float = 0.0):
        """Increment AI usage counters"""
        self.ai_calls_daily += calls
        current_cost = float(self.cost_spent_daily_usd)
        self.cost_spent_daily_usd = str(current_cost + cost_usd)
    
    def reset_daily_limits(self):
        """Reset daily usage limits (called by scheduled task)"""
        self.api_usage_daily = 0
        self.ai_calls_daily = 0
        self.cost_spent_daily_usd = '0.0'
    
    def to_dict(self, include_sensitive: bool = False):
        """Convert to dictionary with optional sensitive data"""
        data = super().to_dict()
        
        if not include_sensitive:
            # Remove sensitive fields from public API
            sensitive_fields = ['password_hash', 'failed_login_attempts', 'account_locked_until']
            for field in sensitive_fields:
                data.pop(field, None)
        
        return data
    
    def get_display_name(self) -> str:
        """Get user's display name"""
        if self.email:
            return self.email.split('@')[0]
        elif self.wallet_address:
            return f"{self.wallet_address[:6]}...{self.wallet_address[-4:]}"
        return f"User {str(self.id)[:8]}"
    
    def update_last_active(self):
        """Update last active timestamp"""
        self.last_active_at = func.now()
    
    def get_tier_features(self) -> dict:
        """Get available features for user's tier"""
        from app.core.config import settings
        return settings.get_ai_cost_limit_for_tier(self.tier)
    
    @classmethod
    def create_from_privy(cls, privy_user_data: dict) -> 'User':
        """Create user from Privy authentication data"""
        return cls(
            privy_id=privy_user_data.get('user_id'),
            email=privy_user_data.get('email'),
            wallet_address=privy_user_data.get('wallet_address'),
            is_verified=True,  # Privy users are pre-verified
            settings={
                'auth_provider': 'privy',
                'social_provider': privy_user_data.get('social_provider'),
            }
        ) 