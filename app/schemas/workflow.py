import uuid
from datetime import datetime
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any

from app.models.workflow import WorkflowStatus, TriggerType

# This Base now only contains fields that are common to both the DB model and response
class WorkflowBase(BaseModel):
    name: str = Field(..., min_length=3, max_length=100, description="Name of the workflow")
    description: Optional[str] = Field(None, max_length=500, description="A brief description of the workflow")
    is_active: bool = Field(..., description="Whether the workflow is active and should be executed")

# This schema is used ONLY for creating a workflow from the frontend
class WorkflowCreate(BaseModel):
    """
    Schema for creating a new workflow. 
    Now accepts trigger and action configs directly from the frontend.
    """
    name: str = Field(..., min_length=3, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    trigger: Dict[str, Any] = Field(..., description="Full trigger configuration object from frontend")
    action: Dict[str, Any] = Field(..., description="Full action configuration object from frontend")

# This schema is used ONLY for updating
class WorkflowUpdate(BaseModel):
    """Schema for updating an existing workflow. All fields are optional."""
    name: Optional[str] = Field(None, min_length=3, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    is_active: Optional[bool] = None
    trigger_config: Optional[Dict[str, Any]] = None
    action_config: Optional[Dict[str, Any]] = None

# This is the main response schema, now correctly matching the DB model structure
class WorkflowResponse(WorkflowBase):
    """Schema for returning a workflow to the client."""
    id: uuid.UUID
    user_id: uuid.UUID
    current_state: WorkflowStatus
    trigger_type: TriggerType
    trigger_config: Dict[str, Any]
    nodes: list[Dict[str, Any]] # Actions are inside nodes
    edges: list[Dict[str, Any]]
    
    # ✅ Transaction data for blockchain integration
    registration_tx_hash: Optional[str] = Field(None, description="Blockchain registration transaction hash")
    upkeep_id: Optional[str] = Field(None, description="Chainlink Automation upkeep ID")
    created_at: Optional[datetime] = Field(None, description="Creation timestamp")
    updated_at: Optional[datetime] = Field(None, description="Last update timestamp")
    
    class Config:
        from_attributes = True

# This paginated response uses the corrected WorkflowResponse
class PaginatedWorkflowResponse(BaseModel):
    """Schema for paginated workflow list response."""
    items: list[WorkflowResponse]
    page: int
    limit: int
    total: int
    has_next_page: bool

class WorkflowListResponse(BaseModel):
    """Schema for returning a list of workflows."""
    id: uuid.UUID
    name: str
    is_active: bool
    current_state: WorkflowStatus
    trigger_summary: str
    action_summary: str

    class Config:
        from_attributes = True
    
    @classmethod
    def from_workflow(cls, workflow):
        """Create from Workflow model instance"""
        return cls(
            id=workflow.id,
            name=workflow.name,
            is_active=workflow.is_active,
            current_state=workflow.current_state,
            trigger_summary=workflow.get_trigger_summary(),
            action_summary=workflow.get_action_summary()
        ) 