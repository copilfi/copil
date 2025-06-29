# backend/app/models/__init__.py

# This file ensures that all models are imported and registered with SQLAlchemy's metadata.
# This is crucial for relationships to be resolved correctly and for Alembic to detect all tables.

from .base import BaseModel, UserOwnedModel
from .user import User
from .workflow import Workflow, WorkflowStatus, TriggerType, ActionType
from .execution import WorkflowExecution, ExecutionStatus
from .portfolio import PortfolioSnapshot
from .security import SecurityAuditLog, CostEvent
from .session_key_grant import SessionKeyGrant

__all__ = [
    "BaseModel",
    "UserOwnedModel",
    "User",
    "Workflow",
    "WorkflowStatus",
    "TriggerType",
    "ActionType",
    "WorkflowExecution",
    "ExecutionStatus",
    "PortfolioSnapshot",
    "SecurityAuditLog",
    "CostEvent",
    "SessionKeyGrant",
] 