import logging
from app.models.workflow import Workflow, TriggerType
from app.services.market.manager import market_manager
from app.db.session import get_db_session
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends
from datetime import datetime, timezone

# Import the new checker service
from app.services.event_checkers.rss_checker_service import RssCheckerService
from app.services.event_checkers.twitter_checker_service import TwitterCheckerService
from app.services.event_checkers.evm_checker_service import EvmCheckerService

logger = logging.getLogger(__name__)

class TriggerCheckerService:
    """
    Checks if a workflow's trigger conditions are met.
    Acts as an orchestrator for different trigger types.
    """
    def __init__(self, session: AsyncSession):
        self.session = session
        self.market_manager = market_manager
        # Initialize checker services here
        self.rss_checker = RssCheckerService()
        try:
            self.twitter_checker = TwitterCheckerService()
        except ValueError:
            logger.warning("TwitterCheckerService could not be initialized. TWITTER_BEARER_TOKEN may be missing.")
            self.twitter_checker = None
        self.evm_checker = EvmCheckerService()

    async def check_workflow(self, workflow: Workflow) -> bool:
        """
        Main dispatcher function. Checks a workflow's trigger and updates its state.
        """
        if not workflow.can_be_triggered:
            return False

        checker_map = {
            TriggerType.PRICE_TRIGGER: self._check_price_trigger,
            TriggerType.TIME_TRIGGER: self._check_time_trigger,
            TriggerType.POLLING_EVENT: self._check_polling_event,
        }

        checker_func = checker_map.get(workflow.trigger_type)
        
        if not checker_func:
            logger.warning(f"No checker function found for trigger type: {workflow.trigger_type}")
            return False

        try:
            return await checker_func(workflow)
        except Exception as e:
            logger.error(f"Error checking workflow {workflow.id} for trigger {workflow.trigger_type}: {e}")
            return False

    async def _check_price_trigger(self, workflow: Workflow) -> bool:
        """
        Checks a price trigger.
        Config requires: 'asset' (str), 'condition' ('above' or 'below'), 'value' (float)
        """
        config = workflow.trigger_config
        asset = config.get("asset")
        condition = config.get("condition")
        target_value = config.get("value")

        if not all([asset, condition, target_value]):
            logger.error(f"Price trigger for workflow {workflow.id} is misconfigured.")
            return False

        try:
            current_price_data = await self.market_manager.get_price(asset)
            current_price = current_price_data.price
            
            logger.debug(f"Checking price for {asset}: Current=${current_price}, Target=${target_value}, Condition={condition}")

            if condition == "above" and current_price > target_value:
                return True
            if condition == "below" and current_price < target_value:
                return True

        except Exception as e:
            logger.error(f"Could not get price for {asset} while checking trigger for workflow {workflow.id}: {e}")
        
        return False

    async def _check_time_trigger(self, workflow: Workflow) -> bool:
        """
        Checks a time trigger.
        Relies on `next_check_at` being set on the workflow.
        """
        if not workflow.next_check_at:
            logger.warning(f"Time trigger for workflow {workflow.id} has no next_check_at time set.")
            return False

        # Ensure all datetimes are timezone-aware (UTC)
        now_utc = datetime.now(timezone.utc)
        
        # next_check_at should already be timezone-aware if stored correctly
        if now_utc >= workflow.next_check_at:
            logger.info(f"Time trigger condition met for workflow {workflow.id}. Current time: {now_utc}, Target time: {workflow.next_check_at}")
            return True
        
        return False

    async def _check_polling_event(self, workflow: Workflow) -> bool:
        """
        Orchestrator for polling-based event triggers.
        Delegates the check to the appropriate service based on the source.
        """
        config = workflow.trigger_config
        source = config.get("source")

        checker_map = {
            "rss": self.rss_checker.check,
            "twitter": self.twitter_checker.check if self.twitter_checker else None,
            "evm": self.evm_checker.check,
        }

        checker_func = checker_map.get(source)
        if not checker_func:
            logger.warning(f"No polling event checker found for source: '{source}' in workflow {workflow.id}")
            return False

        is_triggered, new_state = await checker_func(workflow)

        if is_triggered:
            # Update the workflow state to prevent re-triggering for the same event
            workflow.state = new_state
            self.session.add(workflow)
            # No need to commit here, the calling task will handle it.
            
        return is_triggered


# Dependency for getting the service instance
async def get_trigger_checker_service(session: AsyncSession = Depends(get_db_session)) -> TriggerCheckerService:
    # This is tricky because Celery workers don't have a FastAPI dependency context.
    # We will need to manage the session manually in the Celery task itself.
    # This dependency is here for potential future use via HTTP endpoints if needed.
    return TriggerCheckerService(session) 