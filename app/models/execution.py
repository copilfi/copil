from sqlalchemy import Column, String, Integer, DateTime, Index, ForeignKey, Text, Boolean
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from enum import Enum

from app.models.base import UserOwnedModel


class ExecutionStatus(str, Enum):
    """Execution status enumeration"""
    PENDING = "pending"
    EXECUTING = "executing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"


class WorkflowExecution(UserOwnedModel):
    """Workflow execution tracking for audit and monitoring"""
    __tablename__ = "workflow_executions"
    
    # Relationships
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("workflows.id"), nullable=False, index=True)
    
    # Execution state
    status = Column(String(50), nullable=False, default=ExecutionStatus.PENDING.value, index=True)
    trigger_data = Column(JSONB, nullable=True)
    action_results = Column(JSONB, nullable=True)
    error_message = Column(Text, nullable=True)
    error_details = Column(JSONB, nullable=True)
    
    # Performance tracking
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    execution_duration_ms = Column(Integer, nullable=True)
    
    # Cost tracking
    execution_cost_usd = Column(String, default='0.0', nullable=False)
    gas_used = Column(String, default='0', nullable=False)  # Wei as string
    gas_price_gwei = Column(String, default='0', nullable=False)
    
    # Transaction details
    transaction_hash = Column(String(66), nullable=True, index=True)
    block_number = Column(Integer, nullable=True)
    chain_id = Column(Integer, nullable=True)
    
    # Retry information
    retry_count = Column(Integer, default=0, nullable=False)
    is_retry = Column(Boolean, default=False, nullable=False)
    parent_execution_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    
    # Relationships
    workflow = relationship("Workflow", back_populates="executions")
    
    # Indexes for performance
    __table_args__ = (
        Index('idx_execution_workflow_id', 'workflow_id'),
        Index('idx_execution_user_status', 'user_id', 'status'),
        Index('idx_execution_started_at', 'started_at'),
        Index('idx_execution_transaction_hash', 'transaction_hash'),
        Index('idx_execution_cost', 'execution_cost_usd'),
        # GIN indexes for JSONB
        Index('idx_execution_trigger_data', 'trigger_data', postgresql_using='gin'),
        Index('idx_execution_action_results', 'action_results', postgresql_using='gin'),
    )
    
    def __repr__(self):
        return f"<WorkflowExecution(id={self.id}, workflow_id={self.workflow_id}, status={self.status})>"
    
    @property
    def duration_seconds(self) -> float:
        """Get execution duration in seconds"""
        if not self.execution_duration_ms:
            return 0.0
        return self.execution_duration_ms / 1000.0
    
    @property
    def is_completed(self) -> bool:
        """Check if execution is completed (success or failure)"""
        return self.status in [
            ExecutionStatus.COMPLETED.value,
            ExecutionStatus.FAILED.value,
            ExecutionStatus.CANCELLED.value,
            ExecutionStatus.TIMEOUT.value
        ]
    
    @property
    def is_successful(self) -> bool:
        """Check if execution was successful"""
        return self.status == ExecutionStatus.COMPLETED.value
    
    def start_execution(self, trigger_data: dict = None):
        """Mark execution as started"""
        self.status = ExecutionStatus.EXECUTING.value
        self.started_at = func.now()
        if trigger_data:
            self.trigger_data = trigger_data
    
    def complete_execution(self, action_results: dict = None, transaction_hash: str = None):
        """Mark execution as completed successfully"""
        self.status = ExecutionStatus.COMPLETED.value
        self.completed_at = func.now()
        if action_results:
            self.action_results = action_results
        if transaction_hash:
            self.transaction_hash = transaction_hash
        
        # Calculate duration
        if self.started_at and self.completed_at:
            duration = (self.completed_at - self.started_at).total_seconds()
            self.execution_duration_ms = int(duration * 1000)
    
    def fail_execution(self, error_message: str, error_details: dict = None):
        """Mark execution as failed"""
        self.status = ExecutionStatus.FAILED.value
        self.completed_at = func.now()
        self.error_message = error_message
        if error_details:
            self.error_details = error_details
        
        # Calculate duration even for failures
        if self.started_at and self.completed_at:
            duration = (self.completed_at - self.started_at).total_seconds()
            self.execution_duration_ms = int(duration * 1000)
    
    def cancel_execution(self, reason: str = "User cancelled"):
        """Mark execution as cancelled"""
        self.status = ExecutionStatus.CANCELLED.value
        self.completed_at = func.now()
        self.error_message = reason
    
    def set_cost_info(self, cost_usd: float, gas_used: int = None, gas_price_gwei: float = None):
        """Set cost and gas information"""
        self.execution_cost_usd = str(cost_usd)
        if gas_used is not None:
            self.gas_used = str(gas_used)
        if gas_price_gwei is not None:
            self.gas_price_gwei = str(gas_price_gwei)
    
    def to_dict(self):
        """Convert to dictionary with computed fields"""
        data = super().to_dict()
        data.update({
            'duration_seconds': self.duration_seconds,
            'is_completed': self.is_completed,
            'is_successful': self.is_successful,
        })
        return data 