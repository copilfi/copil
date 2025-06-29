# backend/app/services/security/dev_signing_service.py
import logging
from eth_account import Account
from eth_account.signers.local import LocalAccount

from app.core.config import settings

logger = logging.getLogger(__name__)

class DevelopmentSigningService:
    """
    A simplified signing service for development environments.
    It uses a single, hardcoded private key from the .env file
    and does not interact with a vault or database.
    This should NEVER be used in production.
    """

    def __init__(self):
        if not settings.PRIVATE_KEY:
            raise ValueError("PRIVATE_KEY is not set in the environment variables.")
        
        try:
            self.signer: LocalAccount = Account.from_key(settings.PRIVATE_KEY)
            logger.info(f"DevelopmentSigningService initialized with signer address: {self.signer.address}")
        except Exception as e:
            logger.error(f"Failed to create signer from PRIVATE_KEY: {e}")
            raise ValueError("Invalid PRIVATE_KEY format.") from e

    def get_signer(self) -> LocalAccount:
        """
        Returns the hardcoded signer account.
        This single signer will be used for all transactions in development.
        """
        return self.signer

# Singleton instance for development
try:
    if settings.ENVIRONMENT == "development":
        dev_signing_service = DevelopmentSigningService()
    else:
        dev_signing_service = None
except ValueError as e:
    dev_signing_service = None
    logger.error(f"Could not initialize DevelopmentSigningService: {e}") 