import logging
import httpx
from typing import Dict, Any, Tuple

from app.models.workflow import Workflow
from app.core.config import settings

logger = logging.getLogger(__name__)

# Etherscan API URL for Ethereum Mainnet
ETHERSCAN_API_URL = "https://api.etherscan.io/api"

class EvmCheckerService:
    """
    Checks for new on-chain events on EVM-compatible chains.
    Currently uses Etherscan for transaction history.
    """
    def __init__(self):
        if not settings.ETHERSCAN_API_KEY:
            logger.warning("ETHERSCAN_API_KEY is not configured. On-chain checks will fail.")
            self.api_key = None
        else:
            self.api_key = settings.ETHERSCAN_API_KEY

    async def check(self, workflow: Workflow) -> Tuple[bool, Dict[str, Any]]:
        """
        Checks for a new event based on the workflow's trigger_config.
        """
        if not self.api_key:
            return False, workflow.state
            
        config = workflow.trigger_config
        params = config.get("params", {})
        event_type = params.get("type")

        if event_type == "wallet_transaction":
            return await self._check_wallet_transactions(workflow, params)
        else:
            logger.warning(f"Unsupported EVM event type: '{event_type}' for workflow {workflow.id}")
            return False, workflow.state

    async def _check_wallet_transactions(self, workflow: Workflow, params: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
        """
        Checks for new transactions for a given wallet address.
        """
        state = workflow.state or {}
        address = params.get("address")
        if not address:
            logger.warning(f"No 'address' provided for wallet_transaction check in workflow {workflow.id}")
            return False, state

        last_checked_block = state.get("last_checked_block", 0)

        api_params = {
            "module": "account",
            "action": "txlist",
            "address": address,
            "startblock": last_checked_block + 1,
            "endblock": 99999999, # Latest block
            "sort": "asc",
            "apikey": self.api_key,
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(ETHERSCAN_API_URL, params=api_params)
                response.raise_for_status()
                data = response.json()

                if data["status"] == "0": # "0" means no transactions found
                    return False, state
                
                if data["status"] == "1": # "1" means transactions found
                    transactions = data["result"]
                    # Get the block number of the latest transaction in the response
                    latest_tx = max(transactions, key=lambda tx: int(tx['blockNumber']))
                    newest_block_number = int(latest_tx['blockNumber'])
                    
                    logger.info(f"New transaction found for address '{address}' in workflow {workflow.id}. Block: {newest_block_number}")
                    
                    new_state = {"last_checked_block": newest_block_number}
                    return True, new_state

        except httpx.HTTPStatusError as e:
            logger.error(f"Etherscan API error for workflow {workflow.id}: {e}", exc_info=True)
        except Exception as e:
            logger.error(f"An unexpected error occurred during EVM check for workflow {workflow.id}: {e}", exc_info=True)
            
        return False, state 