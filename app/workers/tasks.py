import logging
import uuid
from datetime import datetime, timedelta, timezone

from app.workers.celery_app import celery_app
from app.db.session import get_async_session, Session
from app.services.trigger_checker_service import TriggerCheckerService
from app.services.action_execution_service import ActionExecutionService
from app.models.workflow import Workflow, WorkflowStatus, TriggerType
from sqlalchemy.future import select
from app.services.event_checkers import ChainlinkCheckerService, EvmCheckerService, RssCheckerService
from app.services.action_executor_service import ActionExecutorService
from sqlalchemy.orm import sessionmaker
import uuid
from datetime import datetime

logger = logging.getLogger(__name__)

# A helper function to run async code inside a sync Celery task
def run_async(async_func):
    import asyncio
    return asyncio.run(async_func)

@celery_app.task(name="workflows.check_all_pending")
def check_pending_workflows():
    """
    Periodically checks all active and pending workflows to see if their triggers are met.
    This is a sync wrapper around the async logic.
    """
    logger.info("Starting periodic check for pending workflows...")
    run_async(_check_pending_workflows_async())


async def _check_pending_workflows_async():
    session_generator = get_async_session()
    session = await session_generator.__anext__()
    
    try:
        trigger_checker = TriggerCheckerService(session)
        
        stmt = select(Workflow).where(
            Workflow.is_active == True,
            Workflow.current_state == WorkflowStatus.PENDING,
            (Workflow.next_check_at <= datetime.now(timezone.utc)) | (Workflow.next_check_at == None)
        )
        result = await session.execute(stmt)
        workflows_to_check = result.scalars().all()
        
        logger.info(f"Found {len(workflows_to_check)} workflows to check.")

        for workflow in workflows_to_check:
            try:
                is_triggered = await trigger_checker.check_workflow(workflow)
                if is_triggered:
                    logger.info(f"Workflow {workflow.id} ({workflow.name}) has been triggered!")
                    workflow.current_state = WorkflowStatus.TRIGGERED
                    workflow.last_triggered_at = datetime.now(timezone.utc)
                    execute_workflow_action.delay(workflow_id=str(workflow.id), user_id=str(workflow.user_id))
                    
            except Exception as e:
                logger.error(f"Failed to check workflow {workflow.id}: {e}", exc_info=True)

        await session.commit()
    finally:
        await session.close()


@celery_app.task(name="workflows.execute_action", bind=True, max_retries=3, default_retry_delay=60)
def execute_workflow_action(self, workflow_id: str, user_id: str):
    """
    Executes the action for a triggered workflow. Handles state and retries.
    """
    logger.info(f"Executing action for workflow {workflow_id} for user {user_id}...")
    
    try:
        run_async(_execute_workflow_action_async(workflow_id, user_id))
    except Exception as e:
        logger.error(f"Execution failed for workflow {workflow_id}. Retrying... Error: {e}")
        self.retry(exc=e)


async def _execute_workflow_action_async(workflow_id: str, user_id: str):
    session_generator = get_async_session()
    session: Session = await session_generator.__anext__()

    try:
        # 1. Fetch workflow and set state to EXECUTING
        result = await session.execute(select(Workflow).where(Workflow.id == uuid.UUID(workflow_id)))
        workflow = result.scalar_one_or_none()

        if not workflow:
            logger.error(f"Workflow {workflow_id} not found for execution.")
            return

        workflow.current_state = WorkflowStatus.EXECUTING
        await session.commit()

        # 2. Call ActionExecutionService
        action_executor = ActionExecutionService(session)
        await action_executor.execute_action(workflow=workflow, user_id=user_id)

        # 3. If successful, update state to COMPLETED
        workflow.current_state = WorkflowStatus.COMPLETED
        logger.info(f"Action for workflow {workflow.id} completed successfully.")

    except Exception as e:
        logger.error(f"Failed to execute action for workflow {workflow_id}: {e}", exc_info=True)
        # On failure, set state to FAILED
        if 'workflow' in locals() and workflow:
            workflow.current_state = WorkflowStatus.FAILED
            workflow.last_error_message = str(e)
    
    finally:
        # 4. Handle recurring workflows
        if 'workflow' in locals() and workflow and workflow.current_state == WorkflowStatus.COMPLETED:
            # If it's a recurring time trigger, schedule the next run
            if workflow.trigger_type == TriggerType.TIME_TRIGGER:
                config = workflow.trigger_config
                if config.get("schedule_type") == "interval":
                    minutes = config.get("minutes", 60)
                    workflow.next_check_at = datetime.now(timezone.utc) + timedelta(minutes=minutes)
                    workflow.current_state = WorkflowStatus.PENDING # Set it back to pending for the next run
                    logger.info(f"Rescheduled workflow {workflow.id} for next run at {workflow.next_check_at}")

        if 'session' in locals():
            await session.commit()
            await session.close()

@celery_app.task(name="monitor_active_workflows")
def monitor_active_workflows():
    """
    Monitor all active workflows for their trigger conditions.
    This task runs periodically to check for events that should trigger workflow execution.
    """
    logger.info("🔍 Starting workflow monitoring cycle...")
    
    try:
        # Create synchronous database session for Celery task
        from app.core.database import engine
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        
        with SessionLocal() as db:
            # Get all active workflows
            stmt = select(Workflow).where(
                Workflow.is_active == True,
                Workflow.current_state == WorkflowStatus.ACTIVE.value
            )
            result = db.execute(stmt)
            active_workflows = result.scalars().all()
            
            logger.info(f"Found {len(active_workflows)} active workflows to monitor")
            
            # Initialize checkers
            chainlink_checker = ChainlinkCheckerService()
            evm_checker = EvmCheckerService() 
            rss_checker = RssCheckerService()
            
            for workflow in active_workflows:
                try:
                    # Determine which checker to use based on trigger type
                    trigger_config = workflow.trigger_config or {}
                    trigger_type = trigger_config.get("type", "")
                    
                    checker = None
                    if trigger_type == "price_condition" and workflow.upkeep_id:
                        # Use Chainlink checker for price conditions with upkeep IDs
                        checker = chainlink_checker
                    elif trigger_type in ["wallet_transaction", "smart_contract_event"]:
                        checker = evm_checker
                    elif trigger_type == "rss_feed":
                        checker = rss_checker
                    
                    if checker:
                        # Check if trigger condition is met
                        import asyncio
                        loop = asyncio.new_event_loop()
                        asyncio.set_event_loop(loop)
                        
                        try:
                            triggered, new_trigger_config = loop.run_until_complete(checker.check(workflow))
                            
                            # Update workflow trigger_config with checker state
                            if new_trigger_config != workflow.trigger_config:
                                workflow.trigger_config = new_trigger_config
                                db.add(workflow)
                                
                            if triggered:
                                logger.info(f"🎯 Workflow {workflow.id} triggered! Executing action...")
                                
                                # Execute the workflow action
                                action_executor = ActionExecutorService(db=db)
                                loop.run_until_complete(
                                    action_executor.execute_workflow_action(workflow)
                                )
                                
                        finally:
                            loop.close()
                    else:
                        logger.warning(f"No suitable checker found for workflow {workflow.id} with trigger type: {trigger_type}")
                        
                except Exception as e:
                    logger.error(f"Error monitoring workflow {workflow.id}: {e}", exc_info=True)
                    continue
            
            # Commit all state updates
            db.commit()
            logger.info("✅ Workflow monitoring cycle completed")
            
    except Exception as e:
        logger.error(f"Critical error in workflow monitoring: {e}", exc_info=True)


@celery_app.task(name="check_chainlink_upkeep_status")
def check_chainlink_upkeep_status(workflow_id: str):
    """
    Check the status of a specific Chainlink upkeep.
    This can be called manually or triggered by other events.
    """
    logger.info(f"🔗 Checking Chainlink upkeep status for workflow: {workflow_id}")
    
    try:
        from app.core.database import engine
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        
        with SessionLocal() as db:
            workflow = db.get(Workflow, uuid.UUID(workflow_id))
            
            if not workflow:
                logger.warning(f"Workflow {workflow_id} not found")
                return
                
            if not workflow.upkeep_id:
                logger.warning(f"Workflow {workflow_id} has no upkeep_id")
                return
            
            chainlink_checker = ChainlinkCheckerService()
            
            import asyncio
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            try:
                upkeep_info = loop.run_until_complete(
                    chainlink_checker.get_upkeep_info(int(workflow.upkeep_id))
                )
                
                if upkeep_info:
                    logger.info(f"Upkeep info for {workflow_id}: {upkeep_info}")
                    
                    # Update workflow metadata with upkeep status
                    metadata = workflow.metadata or {}
                    metadata["chainlink_status"] = upkeep_info
                    metadata["last_status_check"] = datetime.utcnow().isoformat()
                    workflow.metadata = metadata
                    
                    db.add(workflow)
                    db.commit()
                    
            finally:
                loop.close()
                
    except Exception as e:
        logger.error(f"Error checking Chainlink upkeep status for {workflow_id}: {e}", exc_info=True) 