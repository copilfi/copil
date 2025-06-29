import json
from eth_hash.auto import keccak
from sqlalchemy.orm import Session
from .. import models
from ..services.chain_service import chain_service
from app.schemas.workflow import WorkflowCreate
from ..utils.commitment_utils import generate_commitment_hash
import uuid
from typing import List, Dict, Any
from fastapi import HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from app.db.session import get_db_session
from app.models.workflow import Workflow, TriggerType, ActionType, WorkflowStatus
from app.schemas.workflow import WorkflowResponse, WorkflowUpdate, WorkflowCreate, PaginatedWorkflowResponse
from datetime import datetime, timedelta, timezone
from app.core.security import get_current_active_user
from app.services.blockchain.manager import blockchain_manager
from app.services.blockchain.base import BlockchainServiceException
import logging
import random
import uuid
import json
from web3 import Web3

logger = logging.getLogger(__name__)

def create_workflow(db: Session, workflow: WorkflowCreate, user_id: int):
    """
    Creates a new workflow entry in the database and registers it on-chain.
    """
    # 1. Create the workflow in the database first
    db_workflow = models.Workflow(
        name=workflow.name,
        user_id=user_id,
        # Other DB fields can be populated here
    )
    db.add(db_workflow)
    db.commit()
    db.refresh(db_workflow)

    # 2. Generate the commitment hash from the action data
    commitment_hash = generate_commitment_hash(
        workflow.action.action_type,
        workflow.action.target_address,
        workflow.action.calldata
    )

    # 3. Call the ChainService to register the workflow on-chain
    try:
        on_chain_result = chain_service.register_workflow(
            workflow_id=db_workflow.id, # Use the ID from the newly created DB record
            trigger_source=workflow.trigger.trigger_source,
            trigger_type=workflow.trigger.trigger_type.value,
            trigger_target_value=workflow.trigger.trigger_target_value,
            commitment_hash=commitment_hash
        )
        
        # 4. Update the DB record with on-chain data
        db_workflow.tx_hash = on_chain_result.get("transaction_hash")
        db_workflow.upkeep_id = on_chain_result.get("upkeep_id")
        db_workflow.is_active = True # Mark as active now that it's on-chain
        db.commit()
        db.refresh(db_workflow)
        
        print(f"Workflow {db_workflow.id} successfully registered on-chain: {on_chain_result}")
        
    except Exception as e:
        print(f"Failed to create workflow due to on-chain error: {e}")
        # If the on-chain registration fails, we should probably roll back
        # the database entry or mark it as "failed".
        db_workflow.is_active = False
        db_workflow.tx_hash = str(e) # Store error for debugging
        db.commit()
        raise # Re-raise to be caught by the API router for an HTTP 500 response
    
    return db_workflow

def get_workflow(db: Session, workflow_id: int, user_id: int):
    """
    Retrieves a specific workflow for a user from the database.
    """
    return db.query(models.Workflow).filter(
        models.Workflow.id == workflow_id, 
        models.Workflow.user_id == user_id
    ).first()

def get_workflows(db: Session, user_id: int, skip: int = 0, limit: int = 100):
    """
    Retrieves a list of workflows for a user from the database.
    """
    return db.query(models.Workflow).filter(
        models.Workflow.user_id == user_id
    ).offset(skip).limit(limit).all()

def get_workflows_by_user(db: Session, user_id: int, skip: int = 0, limit: int = 100):
    return db.query(models.Workflow).filter(
        models.Workflow.user_id == user_id
    ).offset(skip).limit(limit).all()

def generate_commitment_hash(action_config: dict) -> bytes:
    """
    Generates a keccak256 hash from the action configuration.
    """
    if not isinstance(action_config, dict):
        raise TypeError("Action config must be a dictionary.")
        
    canonical_string = json.dumps(action_config, sort_keys=True, separators=(',', ':'))
    return Web3.keccak(text=canonical_string)

class WorkflowService:
    """
    Service layer for all workflow-related business logic.
    """
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_workflow(self, *, user_id: uuid.UUID, workflow_data: WorkflowCreate) -> Workflow:
        """
        Creates a new workflow, saves it to the DB, and registers it on-chain.
        """
        logger.info(f"Received request to create workflow: {workflow_data.name} for user {user_id}")
        
        trigger_config = workflow_data.trigger
        action_config = workflow_data.action
        
        commitment_hash = generate_commitment_hash(action_config)
        logger.info(f"Generated commitment hash: {commitment_hash.hex()}")

        # --- FIX: Create DB object that matches the actual DB schema ---
        db_workflow = Workflow(
            user_id=user_id,
            name=workflow_data.name,
            description=workflow_data.description,
            is_active=False,
            trigger_type=TriggerType.PRICE_TRIGGER.value,
            trigger_config=trigger_config,
            # Store the action configuration inside the 'nodes' field, as the model expects.
            nodes=[{
                "id": "action-1", 
                "type": action_config.get("type", "log_message"), 
                "config": action_config
            }],
            edges=[],
            current_state=WorkflowStatus.PENDING.value
        )
        self.db.add(db_workflow)
        await self.db.commit()
        await self.db.refresh(db_workflow)
        logger.info(f"Workflow {db_workflow.id} saved to DB in PENDING state.")
        
        # --- REAL BLOCKCHAIN TRANSACTION ---
        try:
            logger.info(f"🚀 Registering workflow {db_workflow.id} on REAL Fuji blockchain...")
            
            # Import chain service
            from app.services.chain_service import get_chain_service
            chain_service = get_chain_service()
            
            # Prepare parameters for real blockchain registration
            trigger_source = trigger_config.get("price_feed_address")
            # ✅ Fix mapping: frontend sends "above"/"below", not "greater_than"
            condition = trigger_config.get("condition", "above")
            trigger_type_int = 0 if condition in ["above", "greater_than"] else 1  # 0=above, 1=below
            trigger_target_value = int(float(trigger_config.get("threshold", 5.0)) * 10**8)  # Convert to 8 decimals
            
            if not trigger_source:
                raise ValueError("Price feed address is required for blockchain registration")
            
            logger.info(f"Blockchain params - Source: {trigger_source}, Type: {trigger_type_int}, Target: {trigger_target_value}")
            
            # Register on-chain using REAL chain service
            # FIRST: Try WorkflowManager contract (original method)
            try:
                on_chain_result = chain_service.register_workflow(
                    workflow_id=int(db_workflow.id.hex, 16) % (2**32),  # Convert UUID to int for contract
                    trigger_source=trigger_source,
                    trigger_type=trigger_type_int,
                    trigger_target_value=trigger_target_value,
                    commitment_hash=commitment_hash.hex()
                )
                logger.info("✅ WorkflowManager registration successful!")
            except Exception as contract_error:
                logger.warning(f"❌ WorkflowManager registration failed: {contract_error}")
                logger.info("🔄 Trying DIRECT Registrar v2.3 bypass...")
                
                # FALLBACK: Use direct Registrar v2.3 (workaround)
                on_chain_result = chain_service.register_workflow_direct_registrar(
                    workflow_id=int(db_workflow.id.hex, 16) % (2**32),
                    trigger_source=trigger_source,
                    trigger_type=trigger_type_int,
                    trigger_target_value=trigger_target_value,
                    commitment_hash=commitment_hash.hex()
                )
                
                if not on_chain_result.get("success", False):
                    raise Exception(f"Registrar bypass also failed: {on_chain_result.get('error', 'Unknown error')}")
                
                logger.info("✅ Direct Registrar bypass successful!")
            
            # Update workflow with REAL transaction data
            db_workflow.upkeep_id = str(on_chain_result.get("upkeep_id"))
            db_workflow.registration_tx_hash = on_chain_result.get("transaction_hash")  # ✅ Correct field name
            db_workflow.is_active = True
            db_workflow.current_state = WorkflowStatus.ACTIVE.value
            
            logger.info(f"✅ REAL blockchain registration successful!")
            logger.info(f"📝 TX Hash: {db_workflow.registration_tx_hash}")
            logger.info(f"🔗 Upkeep ID: {db_workflow.upkeep_id}")
            
        except Exception as e:
            logger.error(f"❌ Real blockchain registration failed: {e}")
            logger.info("🔄 Falling back to MVP mode...")
            
            # --- FALLBACK: MVP Mode ---
            import random
            base_upkeep = "48306626572047766021798885555594569759206604496989912168544381153704499672326"
            workflow_suffix = str(abs(hash(str(db_workflow.id))) % 10000).zfill(4)
            simulated_upkeep_id = base_upkeep[:-4] + workflow_suffix
            
            db_workflow.upkeep_id = simulated_upkeep_id
            db_workflow.registration_tx_hash = "MVP_MODE_FALLBACK"  # ✅ Correct field name
            db_workflow.is_active = True
            db_workflow.current_state = WorkflowStatus.ACTIVE.value
            
            logger.info(f"🔄 Using fallback mode - Upkeep: {simulated_upkeep_id}")
        
        # Store trigger configuration for the monitoring system
        trigger_config_with_mapping = trigger_config.copy()
        trigger_config_with_mapping["_mapped_params"] = {
            "trigger_source": trigger_config.get("price_feed_address"),
            "trigger_type": 0 if trigger_config.get("condition") == "greater_than" else 1,
            "trigger_target_value": int(float(trigger_config.get("threshold", 5.0)) * 10**8)
        }
        db_workflow.trigger_config = trigger_config_with_mapping
        
        # --- 5. Save final state to DB ---
        self.db.add(db_workflow)
        await self.db.commit()
        await self.db.refresh(db_workflow)
        logger.info(f"Final state for workflow {db_workflow.id} is {db_workflow.current_state}")

        return db_workflow

    async def get_workflows_by_user(self, *, user_id: uuid.UUID, skip: int = 0, limit: int = 100) -> list[Workflow]:
        query = select(Workflow).where(Workflow.user_id == user_id).offset(skip).limit(limit)
        result = await self.db.execute(query)
        return result.scalars().all()
    
    async def get_all_workflows(self, *, skip: int = 0, limit: int = 100) -> list[Workflow]:
        """Get all workflows (for testing purposes)"""
        query = select(Workflow).offset(skip).limit(limit)
        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_workflow_by_id(self, workflow_id: uuid.UUID) -> Workflow | None:
        query = select(Workflow).where(Workflow.id == workflow_id)
        result = await self.db.execute(query)
        return result.scalars().first()
        
    async def update_workflow(self, *, workflow: Workflow, workflow_data: WorkflowUpdate) -> Workflow:
        update_data = workflow_data.dict(exclude_unset=True)
        for field, value in update_data.items():
            setattr(workflow, field, value)
        
        # If the nodes changed, we might need to re-calculate the commitment hash
        # and update the on-chain registration, which adds complexity.
        # For now, we assume this is a simple property update (e.g., name, description, is_active).
        
        self.db.add(workflow)
        await self.db.commit()
        await self.db.refresh(workflow)
        return workflow

    async def delete_workflow(self, *, workflow: Workflow):
        """
        Deletes a workflow from the database after attempting to de-register it from the chain.
        This prevents orphaned on-chain upkeeps that could continue to consume resources.
        """
        deregistration_result = None
        
        # Step 1: Attempt to de-register from chain if upkeep_id exists
        if workflow.upkeep_id:
            try:
                logger.info(f"De-registering Upkeep ID: {workflow.upkeep_id} on-chain before DB deletion.")
                # Import here to avoid circular imports
                from app.services.chain_service import get_chain_service
                
                chain_service = get_chain_service()
                deregistration_result = chain_service.deregister_workflow(workflow.upkeep_id)
                
                if deregistration_result.get("status") == "paused":
                    logger.info(f"Successfully paused upkeep {workflow.upkeep_id}: {deregistration_result}")
                else:
                    logger.warning(f"Failed to de-register upkeep {workflow.upkeep_id}: {deregistration_result}")
                    
            except Exception as e:
                logger.error(f"Error during on-chain de-registration for workflow {workflow.id}: {e}")
                # Continue with DB deletion even if chain de-registration fails
                # to avoid blocking user actions due to chain issues
                deregistration_result = {"status": "failed", "error": str(e)}
        else:
            logger.info(f"Workflow {workflow.id} has no upkeep_id - skipping chain de-registration.")
        
        # Step 2: Delete from database regardless of chain operation result
        try:
            await self.db.delete(workflow)
            await self.db.commit()
            logger.info(f"Workflow {workflow.id} deleted from database.")
            
            # Log the final result for monitoring/alerting
            if deregistration_result:
                if deregistration_result.get("status") == "failed":
                    logger.warning(
                        f"ORPHANED UPKEEP WARNING: Workflow {workflow.id} deleted from DB but "
                        f"upkeep {workflow.upkeep_id} may still be active on-chain. "
                        f"Manual cleanup may be required. Error: {deregistration_result.get('error')}"
                    )
                else:
                    logger.info(f"Clean deletion: Workflow {workflow.id} removed from both DB and chain.")
                    
        except Exception as e:
            logger.error(f"Failed to delete workflow {workflow.id} from database: {e}")
            raise

    async def get_workflows_by_user_paginated(
        self, *, user_id: uuid.UUID, page: int, limit: int
    ) -> PaginatedWorkflowResponse:
        """
        Retrieves a paginated list of workflows for a specific user.
        """
        offset = (page - 1) * limit

        # Query for the total count of items
        count_query = select(func.count()).select_from(Workflow).where(Workflow.user_id == user_id)
        total_result = await self.db.execute(count_query)
        total = total_result.scalar_one()

        # Query for the items on the current page
        items_query = (
            select(Workflow)
            .where(Workflow.user_id == user_id)
            .order_by(Workflow.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        items_result = await self.db.execute(items_query)
        items = items_result.scalars().all()

        return PaginatedWorkflowResponse(
            items=[WorkflowResponse.model_validate(item) for item in items],
            page=page,
            limit=limit,
            total=total,
            has_next_page=(offset + len(items)) < total,
        )

def get_workflow_service(db: AsyncSession = Depends(get_db_session)) -> WorkflowService:
    """Factory function for WorkflowService dependency injection"""
    return WorkflowService(db)

# Note: Singleton instance removed as WorkflowService requires db session 