import logging
from typing import Dict, Any

from app.models.workflow import Workflow, ActionType
from app.exceptions import GrantViolationError
from app.services.market.manager import MarketManager

logger = logging.getLogger(__name__)

class GrantService:
    """
    Checks if a workflow action complies with its defined execution_grant.
    """
    def __init__(self):
        self.market_manager = MarketManager()

    async def check_grant(self, workflow: Workflow):
        """
        Orchestrates all grant checks.
        Raises GrantViolationError if any check fails.
        """
        grant = workflow.execution_grant
        if not grant:
            # If no grant is defined, all actions are permitted.
            return

        # --- Run all individual checks ---
        self._check_allowed_actions(grant, workflow)
        await self._check_spending_limit(grant, workflow)
        
        logger.info(f"Execution grant check passed for workflow {workflow.id}")

    def _check_allowed_actions(self, grant: Dict[str, Any], workflow: Workflow):
        """
        Checks if the workflow's action_type is in the list of allowed actions.
        """
        allowed_actions = grant.get("allowed_actions")
        if allowed_actions is None:
            # If the key is not present, this check is skipped.
            return

        if not isinstance(allowed_actions, list):
            raise GrantViolationError("Grant format error: 'allowed_actions' must be a list.")
        
        # We need to compare the enum member, not the string value
        current_action_type = workflow.action_type
        
        if current_action_type.value not in allowed_actions:
            raise GrantViolationError(
                f"Action '{current_action_type.value}' is not permitted by this workflow's grant. "
                f"Allowed actions are: {allowed_actions}"
            )

    async def _check_spending_limit(self, grant: Dict[str, Any], workflow: Workflow):
        """
        Checks if the estimated USD value of an action exceeds the defined limit.
        """
        limit_str = grant.get("max_spend_per_execution_usd")
        if limit_str is None:
            return

        try:
            limit_usd = float(limit_str)
        except (ValueError, TypeError):
            raise GrantViolationError("Grant format error: 'max_spend_per_execution_usd' must be a valid number.")

        # --- Calculate the value of the current action ---
        action_value_usd = 0
        if workflow.action_type == ActionType.SWAP:
            action_config = workflow.action_config
            asset = action_config.get("from_asset")
            amount = action_config.get("amount")

            if not asset or not amount:
                # Not enough info to check the value, so we let it pass for now.
                # Could be stricter in the future.
                return

            try:
                price_data = await self.market_manager.get_price(asset)
                action_value_usd = price_data.price * float(amount)
            except Exception as e:
                logger.error(f"Could not get price for asset {asset} to check spending limit for workflow {workflow.id}: {e}")
                # If we can't get the price, should we fail open (allow) or fail closed (deny)?
                # For security, failing closed is often better, but for UX, failing open might be preferred.
                # Let's fail open for now, but log a warning.
                logger.warning(f"Could not determine action value for workflow {workflow.id}, allowing action to proceed.")
                return

        if action_value_usd > limit_usd:
            raise GrantViolationError(
                f"Action value of ~${action_value_usd:,.2f} exceeds the grant limit of ${limit_usd:,.2f}."
            ) 