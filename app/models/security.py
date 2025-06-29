from sqlalchemy import Column, String, Integer, DateTime, Index, Boolean, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID, INET
from sqlalchemy.sql import func

from app.models.base import BaseModel


class SecurityAuditLog(BaseModel):
    """Security audit log for compliance and monitoring"""
    __tablename__ = "security_audit_log"
    
    # User information (nullable for system events)
    user_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    
    # Event information
    event_type = Column(String(100), nullable=False, index=True)
    event_data = Column(JSONB, nullable=False)
    
    # Request information
    ip_address = Column(INET, nullable=True, index=True)
    user_agent = Column(Text, nullable=True)
    request_path = Column(String(500), nullable=True)
    request_method = Column(String(10), nullable=True)
    
    # Event outcome
    success = Column(Boolean, nullable=False, index=True)
    error_message = Column(Text, nullable=True)
    
    # Risk assessment
    risk_score = Column(String, nullable=True, index=True)  # 0.00 to 1.00 as string
    
    # Additional metadata
    session_id = Column(String(255), nullable=True, index=True)
    device_fingerprint = Column(String(255), nullable=True)
    
    # Indexes for performance and security monitoring
    __table_args__ = (
        Index('idx_security_audit_user_event', 'user_id', 'event_type'),
        Index('idx_security_audit_created_at', 'created_at'),
        Index('idx_security_audit_success', 'success'),
        Index('idx_security_audit_risk_score', 'risk_score'),
        Index('idx_security_audit_ip_address', 'ip_address'),
        Index('idx_security_audit_event_type_time', 'event_type', 'created_at'),
        # GIN index for event_data JSONB
        Index('idx_security_audit_event_data', 'event_data', postgresql_using='gin'),
    )
    
    def __repr__(self):
        return f"<SecurityAuditLog(event_type={self.event_type}, user_id={self.user_id}, success={self.success})>"


class CostEvent(BaseModel):
    """Cost tracking for all external service usage"""
    __tablename__ = "cost_events"
    
    # User information (nullable for system-wide costs)
    user_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    
    # Service information
    service = Column(String(50), nullable=False, index=True)  # 'openai', 'onebalance', 'market_data'
    operation = Column(String(100), nullable=False, index=True)
    
    # Cost information
    cost_usd = Column(String, nullable=False, index=True)  # Precise decimal as string
    currency = Column(String(10), default='USD', nullable=False)
    
    # Request details
    request_details = Column(JSONB, nullable=True)
    response_details = Column(JSONB, nullable=True)
    
    # Performance metrics
    duration_ms = Column(Integer, nullable=True)
    success = Column(Boolean, nullable=False, default=True, index=True)
    error_message = Column(Text, nullable=True)
    
    # Billing period tracking
    billing_date = Column(DateTime(timezone=True), server_default=func.date_trunc('day', func.now()), nullable=False, index=True)
    
    # Indexes for cost analysis and billing
    __table_args__ = (
        Index('idx_cost_events_user_service', 'user_id', 'service'),
        Index('idx_cost_events_service_date', 'service', 'billing_date'),
        Index('idx_cost_events_cost_usd', 'cost_usd'),
        Index('idx_cost_events_operation', 'operation'),
        Index('idx_cost_events_success', 'success'),
        Index('idx_cost_events_created_at', 'created_at'),
        # GIN indexes for JSONB
        Index('idx_cost_events_request_details', 'request_details', postgresql_using='gin'),
    )
    
    def __repr__(self):
        return f"<CostEvent(service={self.service}, operation={self.operation}, cost=${self.cost_usd})>" 