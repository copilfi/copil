# backend/app/listeners/event_listener.py
import asyncio
import logging
from web3 import Web3
from web3.contract import Contract
from web3.logs import DISCARD

from app.core.config import settings
from app.services.action_executor_service import ActionExecutorService
from app.db.session import get_db
from app.core.contracts import get_workflow_manager_contract, get_contract_abi

# Setting up a logger for the event listener
logger = logging.getLogger(__name__)

class EventListener:
    """
    Listens for 'ActionRequired' events from the WorkflowManager smart contract.
    """
    def __init__(self, contract: Contract, action_executor: ActionExecutorService):
        self.contract = contract
        self.action_executor = action_executor
        self.last_checked_block = 0 # In a production system, this should be persisted

    async def poll_for_events(self):
        """
        Polls for 'ActionRequired' events from the last checked block to the latest block.
        MVP: Simplified version with minimal logging.
        """
        try:
            w3 = self.contract.w3
            latest_block = await w3.eth.get_block_number()

            if self.last_checked_block == 0:
                # On first run, start from the latest block to avoid processing old events.
                self.last_checked_block = latest_block - 1

            if latest_block > self.last_checked_block:
                # MVP: Skip actual event processing, just update block tracking
                # Removed debug log to reduce spam
                self.last_checked_block = latest_block

        except Exception as e:
            logger.error(f"Event listener error (MVP mode): {e}")

    async def handle_event(self, event):
        """
        Handles a single 'ActionRequired' event.
        """
        try:
            upkeep_id = event.args.upkeepId
            commitment_hash_bytes = event.args.commitmentHash
            commitment_hash_hex = commitment_hash_bytes.hex()
            
            logger.info(f"Handling event for Upkeep ID: {upkeep_id}, Commitment Hash: {commitment_hash_hex}")

            # Trigger the action executor service
            await self.action_executor.execute_action_from_event(
                upkeep_id=upkeep_id,
                commitment_hash=commitment_hash_hex
            )

        except Exception as e:
            logger.error(f"Error handling event {event}: {e}", exc_info=True)


async def run_listener():
    """
    Main function to initialize and run the event listener.
    MVP: Disabled for minimal setup.
    """
    logger.info("Event listener disabled for MVP - using price monitoring instead.")
    
    # MVP: Just sleep indefinitely without doing anything
    while True:
        await asyncio.sleep(300)  # Sleep for 5 minutes, do nothing 