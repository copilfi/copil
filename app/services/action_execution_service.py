import logging
import httpx
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.config import settings
from app.models.workflow import Workflow, ActionType, WorkflowStatus
from app.models.user import User
from app.services.grant_service import GrantService
from app.exceptions import GrantViolationError

logger = logging.getLogger(__name__)

class ActionExecutionService:
    """
    Executes the action defined in a workflow.
    """
    def __init__(self, session: AsyncSession):
        self.session = session
        self.grant_service = GrantService()

    async def execute_action(self, workflow: Workflow, user_id: str):
        """
        Main dispatcher function for executing an action based on its type.
        """
        try:
            # First, check if the action complies with the defined grant
            await self.grant_service.check_grant(workflow)

            executor_map = {
                ActionType.SWAP: self._execute_swap,
                ActionType.BRIDGE: self._execute_bridge,
                ActionType.NOTIFICATION: self._execute_notification,
            }

            executor_func = executor_map.get(workflow.action_type)
            if not executor_func:
                raise NotImplementedError(f"No executor function found for action type: {workflow.action_type}")

            await executor_func(workflow, user_id)

        except GrantViolationError as e:
            logger.error(f"Grant violation for workflow {workflow.id}: {e.message}")
            workflow.current_state = WorkflowStatus.FAILED
            workflow.last_error_message = f"Permission Denied: {e.message}"
            self.session.add(workflow)
            # Re-raise the exception to stop further processing in the Celery task
            raise
        except Exception:
            # Catch any other exception during execution, mark as failed, and re-raise
            workflow.current_state = WorkflowStatus.FAILED
            self.session.add(workflow)
            raise

    async def _execute_bridge(self, workflow: Workflow, user_id: str):
        """
        Executes a bridge action by calling the OneBalance API.
        The underlying logic is similar to a swap, but may involve different parameters.
        """
        config = workflow.action_config
        logger.info(f"Executing BRIDGE action for workflow {workflow.id} with config: {config}")

        result = await self.session.execute(select(User).where(User.id == uuid.UUID(user_id)))
        user = result.scalar_one_or_none()
        if not user or not (user.sca_address or user.wallet_address):
            raise Exception(f"User {user_id} or their address is not found.")

        target_address = user.sca_address or user.wallet_address
        
        # Prepare the payload for OneBalance. Assuming the 'transfers/quote' can handle bridges.
        # The key difference is providing both `chain_id` and `to_chain_id`.
        quote_payload = {
            "user": target_address,
            "chain_id": config.get("from_chain_id"),
            "to_chain_id": config.get("to_chain_id"),
            "from_asset": config.get("from_asset"),
            "to_asset": config.get("to_asset"),
            "from_amount": str(config.get("amount")),
            "slippage": config.get("slippage", 1.0) # Higher default slippage for bridges
        }

        headers = {"x-api-key": settings.ONEBALANCE_API_KEY, "Content-Type": "application/json"}

        async with httpx.AsyncClient() as client:
            try:
                # 1. Get a quote for the bridge
                quote_response = await client.post(
                    f"{settings.ONEBALANCE_API_URL}/v2/transfers/quote",
                    json=quote_payload,
                    headers=headers
                )
                quote_response.raise_for_status()
                quote_data = quote_response.json()
                logger.info(f"Successfully got bridge quote for workflow {workflow.id}. Quote ID: {quote_data.get('quoteId')}")

                # 2. Execute the quote
                execute_payload = {"quoteId": quote_data.get("quoteId")}
                execute_response = await client.post(
                    f"{settings.ONEBALANCE_API_URL}/v2/transfers/execute",
                    json=execute_payload,
                    headers=headers
                )
                execute_response.raise_for_status()
                execute_data = execute_response.json()
                
                logger.info(f"Successfully executed bridge for workflow {workflow.id}. UserOp Hash: {execute_data.get('userOpHash')}")

            except httpx.HTTPStatusError as e:
                error_body = e.response.json()
                logger.error(f"OneBalance API error for bridge workflow {workflow.id}: {e.response.status_code} - {error_body}")
                raise Exception(f"OneBalance API failed: {error_body.get('message', 'Unknown error')}")

    async def _execute_notification(self, workflow: Workflow, user_id: str):
        """
        Executes a notification action by sending a POST request to a webhook.
        """
        config = workflow.action_config
        logger.info(f"Executing NOTIFICATION action for workflow {workflow.id}")

        webhook_url = config.get("webhook_url")
        message_template = config.get("message", "Workflow '{workflow.name}' has been executed.")
        
        if not webhook_url:
            raise ValueError("Notification action requires a 'webhook_url' in the action_config.")
        
        # Simple templating for the message
        message = message_template.format(workflow=workflow, user_id=user_id)

        payload = {"content": message} # Discord-compatible payload

        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(webhook_url, json=payload)
                response.raise_for_status()
                logger.info(f"Successfully sent notification for workflow {workflow.id} to {webhook_url}")
            except httpx.RequestError as e:
                logger.error(f"Failed to send notification for workflow {workflow.id}: {e}")
                raise Exception(f"Webhook request failed: {e}")

    async def _execute_swap(self, workflow: Workflow, user_id: str):
        """
        Executes a swap action by calling the OneBalance API.
        """
        config = workflow.action_config
        logger.info(f"Executing SWAP action for workflow {workflow.id} with config: {config}")

        # Fetch the user to get their Smart Contract Account address
        result = await self.session.execute(select(User).where(User.id == uuid.UUID(user_id)))
        user = result.scalar_one_or_none()

        if not user:
            raise Exception(f"User {user_id} not found.")

        # Prioritize SCA address, but fall back to the main wallet address (EOA)
        # This makes the system robust for users who have just signed up
        # and may not have their SCA address populated in our DB yet.
        target_address = user.sca_address or user.wallet_address

        if not target_address:
            raise Exception(f"User {user_id} has no address configured (SCA or EOA).")
        
        # Prepare the request to OneBalance get_quote endpoint
        quote_payload = {
            "user": target_address,
            "chain_id": config.get("chain_id", 8453), # Default to Base network
            "from_asset": config.get("from_asset"),
            "to_asset": config.get("to_asset"),
            "from_amount": str(config.get("amount")), # Amount as a string
            "slippage": config.get("slippage", 0.5) # 0.5%
        }

        headers = {
            "x-api-key": settings.ONEBALANCE_API_KEY,
            "Content-Type": "application/json"
        }

        async with httpx.AsyncClient() as client:
            try:
                # 1. Get a quote from OneBalance
                quote_response = await client.post(
                    f"{settings.ONEBALANCE_API_URL}/v2/transfers/quote",
                    json=quote_payload,
                    headers=headers
                )
                quote_response.raise_for_status()
                quote_data = quote_response.json()
                logger.info(f"Successfully got swap quote for workflow {workflow.id}. Quote ID: {quote_data.get('quoteId')}")

                # 2. Execute the quote
                execute_payload = {
                    "quoteId": quote_data.get("quoteId")
                }
                execute_response = await client.post(
                    f"{settings.ONEBALANCE_API_URL}/v2/transfers/execute",
                    json=execute_payload,
                    headers=headers
                )
                execute_response.raise_for_status()
                execute_data = execute_response.json()
                
                logger.info(f"Successfully executed swap for workflow {workflow.id}. UserOp Hash: {execute_data.get('userOpHash')}")
                
            except httpx.HTTPStatusError as e:
                error_body = e.response.json()
                logger.error(f"OneBalance API error for workflow {workflow.id}: {e.response.status_code} - {error_body}")
                raise Exception(f"OneBalance API failed: {error_body.get('message', 'Unknown error')}")
            except Exception as e:
                logger.error(f"An unexpected error occurred during swap execution for workflow {workflow.id}: {e}")
                raise 