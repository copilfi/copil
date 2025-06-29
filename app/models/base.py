from sqlalchemy import Column, String, DateTime, Boolean, Text, Integer, DECIMAL, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.ext.declarative import declared_attr
from sqlalchemy.sql import func
import uuid
from datetime import datetime

from app.core.database import Base


class TimestampMixin:
    """Timestamp mixin for all models"""
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class UUIDMixin:
    """UUID primary key mixin"""
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)


class UserOwnershipMixin:
    """User ownership mixin for multi-tenant security"""
    
    @declared_attr
    def user_id(cls):
        return Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)


class BaseModel(Base, UUIDMixin, TimestampMixin):
    """Base model with common fields"""
    __abstract__ = True
    
    def to_dict(self):
        """Convert model to dictionary"""
        return {
            column.name: getattr(self, column.name)
            for column in self.__table__.columns
        }
    
    def update_from_dict(self, data: dict):
        """Update model from dictionary"""
        for key, value in data.items():
            if hasattr(self, key):
                setattr(self, key, value)


class UserOwnedModel(BaseModel, UserOwnershipMixin):
    """Base model for user-owned resources with multi-tenant security"""
    __abstract__ = True
    
    def validate_ownership(self, user_id: str) -> bool:
        """Validate user owns this resource"""
        return str(self.user_id) == str(user_id) 