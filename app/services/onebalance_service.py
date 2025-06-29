import logging
import httpx
from typing import Optional, Dict, Any

from app.core.config import settings

logger = logging.getLogger(__name__)

class OneBalanceService:
    """
    A service for interacting with the OneBalance API.
    """
    def __init__(self):
        self.api_url = settings.ONEBALANCE_API_URL
        self.api_key = settings.ONEBALANCE_API_KEY
        if not all([self.api_url, self.api_key]):
            raise ValueError("OneBalance API URL and Key must be configured.")

        self.headers = {
            "x-api-key": self.api_key,
            "Content-Type": "application/json"
        }

    async def predict_sca_address(self, user_eoa: str) -> Optional[str]:
        """
        Predicts the Smart Contract Account (SCA) address for a given EOA.

        :param user_eoa: The user's Externally Owned Account address.
        :return: The predicted SCA address as a string, or None if failed.
        """
        if not user_eoa:
            return None

        # The payload might vary based on OneBalance's actual API requirements.
        # This is a common structure. We might need to add `factory_address` etc.
        payload = {
            "user": user_eoa,
            # Chain ID might be needed, default to a common one for prediction
            "chain_id": 8453 # Base network as a default
        }
        
        predict_url = f"{self.api_url}/v2/accounts/predict-address"

        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(predict_url, json=payload, headers=self.headers)
                response.raise_for_status()
                data = response.json()
                
                sca_address = data.get("address")
                if sca_address:
                    logger.info(f"Predicted SCA address {sca_address} for EOA {user_eoa}")
                    return sca_address
                else:
                    logger.error(f"OneBalance predict-address response did not contain an address. Response: {data}")
                    return None

            except httpx.HTTPStatusError as e:
                error_body = e.response.json()
                logger.error(f"OneBalance API error predicting address for EOA {user_eoa}: {e.response.status_code} - {error_body}")
                return None
            except Exception as e:
                logger.error(f"An unexpected error occurred while predicting SCA address for EOA {user_eoa}: {e}")
                return None 