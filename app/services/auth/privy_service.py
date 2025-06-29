import jwt
import logging
from typing import Dict, Any, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

class PrivyService:
    """
    Handles verification of Privy access tokens.
    """
    def __init__(self):
        self.app_id = settings.PRIVY_APP_ID
        self.app_secret = settings.PRIVY_APP_SECRET
        self.verification_key = settings.PRIVY_VERIFICATION_KEY
        
        if not all([self.app_id, self.verification_key]):
            raise ValueError("Privy settings (APP_ID, VERIFICATION_KEY) must be configured.")

    def verify_token(self, token: str) -> Optional[Dict[str, Any]]:
        """
        Verifies a Privy JWT.

        :param token: The access token from the 'Authorization' header.
        :return: The decoded claims dictionary if valid, otherwise None.
        """
        if not token:
            return None
        
        try:
            # Decode the token using Privy's public verification key
            decoded_token = jwt.decode(
                token,
                self.verification_key,
                algorithms=["ES256"],
                audience=self.app_id,
                issuer="privy.io",
            )
            return decoded_token
        except jwt.ExpiredSignatureError:
            logger.warning("Privy token has expired.")
            return None
        except jwt.InvalidTokenError as e:
            logger.error(f"Invalid Privy token: {e}")
            return None 