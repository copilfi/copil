# backend/app/services/security/signing_service.py
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

from eth_account import Account
from eth_account.signers.local import LocalAccount
from sqlalchemy.orm import Session
from sqlalchemy.future import select
from sqlalchemy import and_

from app.services.security.vault_service import vault_service, VaultException
from app.models.user import User
from app.models.session_key_grant import SessionKeyGrant

logger = logging.getLogger(__name__)

class SigningException(Exception):
    """Custom exception for signing service errors."""
    pass

class SigningService:
    """
    Manages the creation, storage, and usage of session keys for signing transactions.
    """

    def __init__(self):
        if not vault_service:
            raise SigningException("VaultService is not available, cannot initialize SigningService.")
        self.vault = vault_service

    async def create_and_store_session_key(
        self,
        db: Session,
        user: User,
        permissions: Dict[str, Any],
        description: str,
        duration_hours: int = 24,
    ) -> SessionKeyGrant:
        """
        Creates a new session key, encrypts it, and stores it in the database.
        """
        account: LocalAccount = Account.create()
        private_key_bytes = account.key
        public_address = account.address

        # The encryption context is crucial for security. It ensures that the key
        # can only be decrypted when the correct user and public address are provided.
        encryption_context = {
            "user_id": str(user.id),
            "session_key_address": public_address
        }

        try:
            encrypted_pk_b64 = self.vault.encrypt_to_base64(private_key_bytes, encryption_context)
        except VaultException as e:
            logger.error(f"Failed to encrypt new session key for user {user.id}: {e}")
            raise SigningException("Could not encrypt session key.") from e

        expires_at = datetime.utcnow() + timedelta(hours=duration_hours)

        grant = SessionKeyGrant(
            user_id=user.id,
            public_address=public_address,
            encrypted_private_key=encrypted_pk_b64,
            encryption_context=encryption_context,
            permissions=permissions,
            expires_at=expires_at,
            description=description,
        )

        db.add(grant)
        await db.commit()
        await db.refresh(grant)

        logger.info(f"Created and stored new session key grant {grant.id} for user {user.id}")
        return grant

    async def find_valid_grant_for_action(
        self,
        db: Session,
        user_id: str,
        target_contract: str,
        value: int
    ) -> Optional[SessionKeyGrant]:
        """
        Finds a non-expired session key grant that has permission for a specific action.
        This is a simplified permission check. A real system would be more complex.
        """
        now = datetime.utcnow()
        query = select(SessionKeyGrant).where(
            SessionKeyGrant.user_id == user_id,
            SessionKeyGrant.expires_at > now,
            # This is a simplified check. We're checking if the target contract is in the allowed list.
            # In a real system, you'd parse the permissions JSON more deeply.
            SessionKeyGrant.permissions['allowed_targets'].astext.contains(target_contract)
        )
        
        result = await db.execute(query)
        
        # Check all potential grants for value limitations
        for grant in result.scalars().all():
            if self._check_spend_limits(grant, value):
                logger.info(f"Found valid grant {grant.id} for action at target {target_contract} with value {value}")
                return grant
            else:
                logger.warning(f"Grant {grant.id} denied: value {value} exceeds spend limits")
        
        # No valid grant found that satisfies spend limits
        logger.warning(f"No valid grant found for target {target_contract} with value {value}")
        return None

    def _check_spend_limits(self, grant: SessionKeyGrant, value: int) -> bool:
        """
        Check if the transaction value is within the spend limits defined in the grant permissions.
        
        Expected permission structure:
        {
            "allowed_targets": ["0x123...", "0x456..."],
            "spend_limits": {
                "max_spend_per_tx": 1000000000000000000,  # in wei (1 ETH)
                "max_spend_per_day": 5000000000000000000,  # in wei (5 ETH)  
                "currency": "wei"
            }
        }
        """
        try:
            permissions = grant.permissions
            
            # If no spend limits defined, allow any value (backward compatibility)
            if "spend_limits" not in permissions:
                logger.debug(f"Grant {grant.id} has no spend limits defined - allowing transaction")
                return True
            
            spend_limits = permissions["spend_limits"]
            
            # Check per-transaction limit
            max_per_tx = spend_limits.get("max_spend_per_tx")
            if max_per_tx is not None and value > max_per_tx:
                logger.warning(
                    f"Grant {grant.id}: Transaction value {value} exceeds max_spend_per_tx {max_per_tx}"
                )
                return False
            
            # TODO: Implement daily spend limit tracking
            # This would require tracking spent amounts per day in the database
            max_per_day = spend_limits.get("max_spend_per_day")
            if max_per_day is not None:
                # For now, just log that daily limits exist but aren't implemented
                logger.debug(
                    f"Grant {grant.id} has daily limit {max_per_day} (tracking not yet implemented)"
                )
            
            logger.debug(f"Grant {grant.id}: Transaction value {value} within spend limits")
            return True
            
        except (KeyError, TypeError, ValueError) as e:
            logger.error(f"Error checking spend limits for grant {grant.id}: {e}")
            # In case of error parsing permissions, deny for security
            return False

    async def get_signer_for_grant(self, grant: SessionKeyGrant) -> LocalAccount:
        """
        Decrypts the private key from a grant and returns a usable signer account.
        """
        try:
            decrypted_pk_bytes = self.vault.decrypt_from_base64(
                grant.encrypted_private_key,
                grant.encryption_context
            )
            signer: LocalAccount = Account.from_key(decrypted_pk_bytes)
            
            # Security check: ensure the decrypted key's address matches the one in the DB.
            if signer.address != grant.public_address:
                raise SigningException("Decrypted key address does not match stored public address. Tampering detected.")
                
            return signer
        except VaultException as e:
            logger.error(f"Failed to decrypt session key for grant {grant.id}: {e}")
            raise SigningException("Could not decrypt session key for signing.") from e
        finally:
            # Clear the decrypted key from memory as soon as possible, although Python's GC
            # makes this less deterministic. In a lower-level language, you'd zero out the memory.
            decrypted_pk_bytes = None


# Singleton instance
try:
    signing_service = SigningService()
except SigningException:
    signing_service = None
    logger.warning("Signing service is not available. Any feature requiring transaction signing will fail.") 