from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Enum as SQLAlchemyEnum, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum

from app.core.database import Base

class WorkflowExecutionStatus(str, enum.Enum):
    STARTED = "STARTED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

class WorkflowExecution(Base):
    id = Column(Integer, primary_key=True, index=True)
    workflow_id = Column(Integer, ForeignKey("workflow.id"), nullable=False)
    
    status = Column(SQLAlchemyEnum(WorkflowExecutionStatus), nullable=False, default=WorkflowExecutionStatus.STARTED)
    
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # NEW: To track progress through a multi-node workflow using node IDs
    current_node_id = Column(String, nullable=True)

    # To store outputs from nodes (e.g., amount from a swap) to be used by subsequent nodes.
    # The keys will be node IDs.
    execution_data = Column(JSON, nullable=True, default=dict)

    # To store the final result or error details
    result = Column(JSON, nullable=True)
    
    # Transaction hash for executed swaps/actions
    transaction_hash = Column(String, nullable=True)

    workflow = relationship("Workflow", back_populates="executions")

    def start_execution(self, start_node_id: str):
        self.status = WorkflowExecutionStatus.IN_PROGRESS
        self.started_at = func.now()
        self.completed_at = None
        self.result = None
        self.current_node_id = start_node_id
        self.execution_data = {}

    def advance_to_node(self, next_node_id: str):
        self.status = WorkflowExecutionStatus.IN_PROGRESS
        self.current_node_id = next_node_id

    def complete_execution(self, final_result: dict):
        self.status = WorkflowExecutionStatus.COMPLETED
        self.completed_at = func.now()
        self.result = final_result
        self.current_node_id = None

    def fail_execution(self, error: dict):
        self.status = WorkflowExecutionStatus.FAILED
        self.completed_at = func.now()
        self.result = {"error": str(error), "failed_at_node": self.current_node_id} 