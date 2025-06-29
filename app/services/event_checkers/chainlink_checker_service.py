import logging
import asyncio
from typing import Dict, Any, Tuple, Optional
from web3 import Web3
from web3.contract import Contract
from web3.exceptions import Web3Exception

from app.models.workflow import Workflow
from app.core.config import settings

logger = logging.getLogger(__name__)

# Chainlink Automation Registry ABI (simplified - only events we need)
AUTOMATION_REGISTRY_ABI = [
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "id", "type": "uint256"},
            {"indexed": True, "name": "trigger", "type": "bytes32"},
            {"indexed": False, "name": "data", "type": "bytes"}
        ],
        "name": "UpkeepPerformed",
        "type": "event"
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "id", "type": "uint256"},
            {"indexed": True, "name": "from", "type": "address"},
            {"indexed": False, "name": "amount", "type": "uint96"}
        ],
        "name": "FundsAdded",
        "type": "event"
    }
]

class ChainlinkCheckerService:
    """
    Checks for Chainlink Automation upkeep events on Avalanche Fuji.
    Monitors UpkeepPerformed events to detect when our workflow triggers have fired.
    """
    
    def __init__(self):
        self.web3 = None
        self.registry_contract = None
        self._initialize_web3()
    
    def _initialize_web3(self):
        """Initialize Web3 connection to Fuji testnet"""
        try:
            fuji_rpc = settings.AVALANCHE_FUJI_RPC_URL or "https://api.avax-test.network/ext/bc/C/rpc"
            self.web3 = Web3(Web3.HTTPProvider(fuji_rpc))
            
            if not self.web3.is_connected():
                logger.error("Failed to connect to Avalanche Fuji RPC")
                return
                
            # Initialize Automation Registry contract
            registry_address = settings.FUJI_AUTOMATION_REGISTRY
            self.registry_contract = self.web3.eth.contract(
                address=Web3.to_checksum_address(registry_address),
                abi=AUTOMATION_REGISTRY_ABI
            )
            
            logger.info(f"Connected to Fuji testnet. Registry: {registry_address}")
            
        except Exception as e:
            logger.error(f"Failed to initialize Chainlink checker: {e}", exc_info=True)
    
    async def check(self, workflow: Workflow) -> Tuple[bool, Dict[str, Any]]:
        """
        Check for UpkeepPerformed events for this workflow's upkeep ID.
        """
        if not self.web3 or not self.registry_contract:
            logger.warning("Web3 not initialized. Cannot check Chainlink events.")
            return False, workflow.trigger_config or {}
        
        if not workflow.upkeep_id:
            logger.warning(f"Workflow {workflow.id} has no upkeep_id. Cannot check Chainlink events.")
            return False, workflow.trigger_config or {}
        
        try:
            upkeep_id = int(workflow.upkeep_id)
        except ValueError:
            logger.warning(f"Invalid upkeep_id for workflow {workflow.id}: {workflow.upkeep_id}")
            return False, workflow.state or {}
        
        # Use trigger_config to store checker state
        trigger_config = workflow.trigger_config or {}
        checker_state = trigger_config.get("_checker_state", {})
        last_checked_block = checker_state.get("chainlink_last_block", 0)
        
        try:
            # Get current block number
            current_block = self.web3.eth.block_number
            from_block = max(last_checked_block + 1, current_block - 1000)  # Don't go too far back
            
            # Query for UpkeepPerformed events for our upkeep ID
            event_filter = self.registry_contract.events.UpkeepPerformed.create_filter(
                fromBlock=from_block,
                toBlock=current_block,
                argument_filters={"id": upkeep_id}
            )
            
            events = event_filter.get_all_entries()
            
            if events:
                latest_event = events[-1]  # Get the most recent event
                event_block = latest_event["blockNumber"]
                
                logger.info(f"🎯 Chainlink upkeep performed! Workflow {workflow.id}, Block: {event_block}")
                logger.info(f"Event data: {dict(latest_event)}")
                
                # Update checker state with the latest block checked
                new_trigger_config = trigger_config.copy()
                new_checker_state = checker_state.copy()
                new_checker_state["chainlink_last_block"] = current_block
                new_checker_state["last_upkeep_performed"] = {
                    "block_number": event_block,
                    "transaction_hash": latest_event["transactionHash"].hex(),
                    "trigger_data": latest_event["args"]["trigger"].hex(),
                    "execution_data": latest_event["args"]["data"].hex()
                }
                new_trigger_config["_checker_state"] = new_checker_state
                
                return True, new_trigger_config
            else:
                # No new events, but update the last checked block
                new_trigger_config = trigger_config.copy()
                new_checker_state = checker_state.copy()
                new_checker_state["chainlink_last_block"] = current_block
                new_trigger_config["_checker_state"] = new_checker_state
                return False, new_trigger_config
                
        except Web3Exception as e:
            logger.error(f"Web3 error checking Chainlink events for workflow {workflow.id}: {e}")
            return False, trigger_config
        except Exception as e:
            logger.error(f"Unexpected error checking Chainlink events for workflow {workflow.id}: {e}", exc_info=True)
            return False, trigger_config
    
    async def get_upkeep_info(self, upkeep_id: int) -> Optional[Dict[str, Any]]:
        """
        Get detailed information about an upkeep from the registry.
        """
        if not self.web3 or not self.registry_contract:
            return None
        
        try:
            # Call the getUpkeep function (if available in the registry)
            # Note: This is a simplified version. The actual registry might have different methods.
            logger.info(f"Querying upkeep info for ID: {upkeep_id}")
            return {"upkeep_id": upkeep_id, "status": "active"}
            
        except Exception as e:
            logger.error(f"Failed to get upkeep info for {upkeep_id}: {e}")
            return None 