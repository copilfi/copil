from sqlalchemy import Column, String, Boolean, Integer, DateTime, Index, ForeignKey, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from enum import Enum
import uuid
from datetime import datetime
from typing import Optional

from app.models.base import UserOwnedModel


class WorkflowStatus(str, Enum):
    """Workflow status enumeration"""
    PENDING = "pending"
    ACTIVE = "active"
    TRIGGERED = "triggered"
    EXECUTING = "executing"
    WAITING_SIGNATURE = "waiting_signature"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    PAUSED = "paused"
    BATCH_OPERATIONS = "batch_operations"


class TriggerType(str, Enum):
    """Trigger type enumeration"""
    # Core Triggers
    PRICE_TRIGGER = "price_trigger"
    TIME_TRIGGER = "time_trigger"
    PORTFOLIO_TRIGGER = "portfolio_trigger"
    MANUAL_TRIGGER = "manual_trigger"

    # Market & External Event Triggers
    MARKET_TRIGGER = "market_trigger"  # For generic market events like fear/greed index
    WEBHOOK_TRIGGER = "webhook_trigger" # For external signals like TradingView alerts

    # Advanced On-Chain Triggers (Chainlink-powered)
    VOLATILITY_TRIGGER = "volatility_trigger" # For asset volatility changes
    L2_HEALTH_TRIGGER = "l2_health_trigger"   # For L2 sequencer status
    ONCHAIN_EVENT_TRIGGER = "onchain_event_trigger" # For specific smart contract events
    RATE_TRIGGER = "rate_trigger" # For interest rate changes (e.g. AAVE)

    # New member
    POLLING_EVENT = "polling_event"


class ActionType(str, Enum):
    """Action type enumeration"""
    SWAP = "swap"
    BRIDGE = "bridge"
    NOTIFICATION = "notification"
    WEBHOOK = "webhook"
    BATCH_OPERATIONS = "batch_operations"


class Workflow(UserOwnedModel):
    """
    Represents a Directed Acyclic Graph (DAG) of actions to be executed when a trigger condition is met.
    """
    __tablename__ = "workflows"
    
    # Basic workflow information
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=False, nullable=False)
    
    # The trigger that starts the entire workflow.
    trigger_type = Column(String(50), nullable=False, index=True)
    trigger_config = Column(JSONB, nullable=False)
    
    # On-chain specific data for the trigger (e.g., Chainlink Automation)
    upkeep_id = Column(String, nullable=True, index=True, unique=True, comment="The ID returned by Chainlink Automation registry.")
    registration_tx_hash = Column(String, nullable=True, comment="Transaction hash from blockchain registration")
    
    # The structure of the workflow as a graph.
    nodes = Column(JSONB, nullable=False, default=list, comment=(
        "List of nodes in the graph. Each node is a dict with: "
        "{'id': str, 'type': str (e.g., 'swap', 'condition'), 'config': dict}"
    ))
    edges = Column(JSONB, nullable=False, default=list, comment=(
        "List of edges connecting nodes. Each edge is a dict with: "
        "{'source': str (node_id), 'target': str (node_id), 'label': str (e.g., 'on_true', 'on_false', 'default')}"
    ))

    # State management
    current_state = Column(String(50), default=WorkflowStatus.PENDING.value, nullable=False, index=True)
    last_triggered_at = Column(DateTime(timezone=True), nullable=True)
    last_executed_at = Column(DateTime(timezone=True), nullable=True)
    next_check_at = Column(DateTime(timezone=True), nullable=True, index=True)  # For scheduled checks
    
    # Performance tracking
    execution_count = Column(Integer, default=0, nullable=False)
    success_count = Column(Integer, default=0, nullable=False)
    failure_count = Column(Integer, default=0, nullable=False)
    total_gas_saved_wei = Column(String, default='0', nullable=False)  # Wei as string
    total_volume_usd = Column(String, default='0.0', nullable=False)   # USD as string
    
    # Error handling
    max_retries = Column(Integer, default=3, nullable=False)
    current_retry_count = Column(Integer, default=0, nullable=False)
    last_error_message = Column(Text, nullable=True)
    last_error_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    user = relationship("User", back_populates="workflows")
    executions = relationship("WorkflowExecution", back_populates="workflow", cascade="all, delete-orphan")
    
    # Indexes for performance
    __table_args__ = (
        Index('idx_workflow_user_active', 'user_id', 'is_active'),
        Index('idx_workflow_trigger_type', 'trigger_type'),
        Index('idx_workflow_state', 'current_state'),
        Index('idx_workflow_next_check', 'next_check_at'),
        Index('idx_workflow_last_triggered', 'last_triggered_at'),
        # GIN indexes for JSONB queries
        Index('idx_workflow_trigger_config', 'trigger_config', postgresql_using='gin'),
        Index('idx_workflow_nodes', 'nodes', postgresql_using='gin'),
        Index('idx_workflow_edges', 'edges', postgresql_using='gin'),
    )
    
    def __repr__(self):
        return f"<Workflow(id={self.id}, name='{self.name}', state='{self.current_state}')>"
    
    @property
    def start_node_id(self) -> Optional[str]:
        """Finds the starting node of the graph (a node that is not a target of any edge)."""
        if not self.nodes:
            return None
        
        target_ids = {edge.get('target') for edge in self.edges}
        for node in self.nodes:
            if node.get('id') not in target_ids:
                return node.get('id')
        
        # As a fallback for simple or cyclic graphs, return the first node.
        return self.nodes[0].get('id') if self.nodes else None

    @property
    def success_rate(self) -> float:
        """Calculate success rate percentage"""
        if self.execution_count == 0:
            return 0.0
        return (self.success_count / self.execution_count) * 100
    
    @property
    def is_running(self) -> bool:
        """Check if workflow is currently running"""
        return self.current_state in [
            WorkflowStatus.TRIGGERED.value,
            WorkflowStatus.EXECUTING.value,
            WorkflowStatus.WAITING_SIGNATURE.value
        ]
    
    @property
    def can_be_triggered(self) -> bool:
        """Check if workflow can be triggered"""
        return (
            self.is_active and 
            not self.is_running and 
            self.current_state not in [WorkflowStatus.FAILED.value, WorkflowStatus.CANCELLED.value]
        )
    
    def update_state(self, new_state: str, error_message: str = None):
        """Update workflow state with proper logging"""
        old_state = self.current_state
        self.current_state = new_state
        
        if error_message:
            self.last_error_message = error_message
            self.last_error_at = func.now()
            self.failure_count += 1
        
        # Reset retry count on state change (except for retries)
        if new_state != WorkflowStatus.FAILED.value:
            self.current_retry_count = 0
    
    def increment_execution_count(self, success: bool = True):
        """Increment execution counters"""
        self.execution_count += 1
        if success:
            self.success_count += 1
        else:
            self.failure_count += 1
        
        self.last_executed_at = func.now()
    
    def can_retry(self) -> bool:
        """Check if workflow can be retried"""
        return (
            self.current_state == WorkflowStatus.FAILED.value and
            self.current_retry_count < self.max_retries
        )
    
    def schedule_retry(self, delay_minutes: int = 5):
        """Schedule workflow retry"""
        if self.can_retry():
            self.current_retry_count += 1
            self.next_check_at = func.now() + func.interval(f'{delay_minutes} minutes')
            self.current_state = WorkflowStatus.PENDING.value
    
    def get_trigger_summary(self) -> str:
        """Get human-readable trigger summary"""
        trigger_summaries = {
            TriggerType.PRICE_TRIGGER.value: self._get_price_trigger_summary(),
            TriggerType.TIME_TRIGGER.value: self._get_time_trigger_summary(),
            TriggerType.PORTFOLIO_TRIGGER.value: self._get_portfolio_trigger_summary(),
            TriggerType.MARKET_TRIGGER.value: self._get_market_trigger_summary(),
        }
        return trigger_summaries.get(self.trigger_type, f"Unknown trigger: {self.trigger_type}")
    
    def get_action_summary(self) -> str:
        """Get human-readable action summary for the graph."""
        if not self.nodes:
            return "No actions defined."
        
        node_types = [node.get('type', 'unknown') for node in self.nodes]
        return f"A sequence of {len(node_types)} actions: {' -> '.join(node_types)}"
    
    def _get_price_trigger_summary(self) -> str:
        """Get price trigger summary"""
        config = self.trigger_config
        asset = config.get('asset', 'Unknown')
        condition = config.get('condition', 'unknown')
        threshold = config.get('threshold', 'N/A')
        
        if condition == 'above':
            return f"When {asset} price goes above ${threshold}"
        elif condition == 'below':
            return f"When {asset} price goes below ${threshold}"
        return f"When {asset} price condition is met"
    
    def _get_time_trigger_summary(self) -> str:
        """Get time trigger summary"""
        config = self.trigger_config
        schedule_type = config.get('schedule_type', 'unknown')
        
        if schedule_type == 'once':
            return f"Once at {config.get('datetime', 'specified time')}"
        elif schedule_type == 'recurring':
            return f"Every {config.get('interval', 'period')}"
        return "At scheduled time"
    
    def _get_portfolio_trigger_summary(self) -> str:
        """Get portfolio trigger summary"""
        config = self.trigger_config
        condition = config.get('condition', 'unknown')
        threshold = config.get('threshold', 'N/A')
        
        return f"When portfolio {condition} {threshold}%"
    
    def _get_market_trigger_summary(self) -> str:
        """Get market trigger summary"""
        config = self.trigger_config
        return f"When market condition: {config.get('condition', 'unknown')}"
    
    def to_dict(self):
        """Convert to dictionary with additional computed fields"""
        data = super().to_dict()
        data.update({
            'success_rate': self.success_rate,
            'is_running': self.is_running,
            'can_be_triggered': self.can_be_triggered,
            'trigger_summary': self.get_trigger_summary(),
            'action_summary': self.get_action_summary(),
            'can_retry': self.can_retry()
        })
        return data
    
    @classmethod
    def create_simple_workflow(
        cls,
        user_id: uuid.UUID,
        name: str,
        trigger_type: str,
        trigger_config: dict,
        action_type: str,
        action_config: dict,
        description: str = None
    ) -> 'Workflow':
        """Create a simple workflow (MVP pattern)"""
        return cls(
            user_id=user_id,
            name=name,
            description=description,
            trigger_type=trigger_type,
            trigger_config=trigger_config,
            current_state=WorkflowStatus.PENDING.value
        ) 