from sqlalchemy import Column, String, DateTime, Index, ForeignKey, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
from datetime import datetime

from app.models.base import UserOwnedModel

class SessionKeyGrant(UserOwnedModel):
    """
    Represents a grant of permission for a session key to perform actions.
    A session key is a short-lived key authorized by the user to be used by the backend.
    """
    __tablename__ = "session_key_grants"

    # The public address of the session key.
    public_address = Column(String(42), nullable=False, unique=True, index=True)

    # The session key's private key, encrypted by the SecureVaultService.
    # Stored as a string because the encrypted output is base64 encoded.
    encrypted_private_key = Column(Text, nullable=False)

    # The encryption context used with KMS, essential for decryption.
    # Stored as JSON to ensure structure.
    encryption_context = Column(JSONB, nullable=False)

    # The permissions granted to this key.
    # This defines what the key is allowed to do.
    permissions = Column(JSONB, nullable=False)
    
    # Expiration date for the key grant.
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)

    # A description for the user to identify this grant.
    description = Column(String(255), nullable=True)

    # Relationships
    user = relationship("User", back_populates="session_key_grants")

    __table_args__ = (
        Index('idx_session_key_user_expires', 'user_id', 'expires_at'),
        # A GIN index on permissions can speed up queries looking for specific grants.
        Index('idx_session_key_permissions', 'permissions', postgresql_using='gin'),
    )

    def __repr__(self):
        return f"<SessionKeyGrant(id={self.id}, user_id={self.user_id}, expires_at={self.expires_at})>"

    @property
    def is_expired(self) -> bool:
        """Checks if the grant has expired."""
        return self.expires_at <= datetime.now(self.expires_at.tzinfo) 