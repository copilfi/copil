from sqlalchemy import Column, String, Integer, DateTime, Index, DECIMAL
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.models.base import UserOwnedModel


class PortfolioSnapshot(UserOwnedModel):
    """Portfolio snapshot for tracking user's multi-chain portfolio over time"""
    __tablename__ = "portfolio_snapshots"
    
    # Wallet information
    sca_address = Column(String(42), nullable=False, index=True)
    
    # Portfolio aggregated data
    total_value_usd = Column(String, nullable=False, default='0.0')  # Total portfolio value in USD
    
    # Asset breakdown - {asset_symbol: {amount, value_usd, chain, contract_address}}
    asset_breakdown = Column(JSONB, nullable=False, default=dict)
    
    # Chain breakdown - {chain_name: {total_value_usd, asset_count}}
    chain_breakdown = Column(JSONB, nullable=False, default=dict)
    
    # Performance metrics
    daily_change_usd = Column(String, default='0.0', nullable=False)
    daily_change_percent = Column(String, default='0.0', nullable=False)
    
    # Snapshot metadata
    snapshot_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    data_sources = Column(JSONB, nullable=True)  # Track which APIs provided data
    
    # Relationships
    user = relationship("User", back_populates="portfolio_snapshots")
    
    # Indexes for performance
    __table_args__ = (
        Index('idx_portfolio_user_sca', 'user_id', 'sca_address'),
        Index('idx_portfolio_snapshot_at', 'snapshot_at'),
        Index('idx_portfolio_total_value', 'total_value_usd'),
        Index('idx_portfolio_sca_latest', 'sca_address', 'snapshot_at'),
        # GIN indexes for JSONB queries
        Index('idx_portfolio_assets', 'asset_breakdown', postgresql_using='gin'),
        Index('idx_portfolio_chains', 'chain_breakdown', postgresql_using='gin'),
    )
    
    def __repr__(self):
        return f"<PortfolioSnapshot(id={self.id}, user_id={self.user_id}, value=${self.total_value_usd})>"
    
    @property
    def total_value_float(self) -> float:
        """Get total value as float"""
        try:
            return float(self.total_value_usd)
        except (ValueError, TypeError):
            return 0.0
    
    @property
    def daily_change_float(self) -> float:
        """Get daily change as float"""
        try:
            return float(self.daily_change_usd)
        except (ValueError, TypeError):
            return 0.0
    
    @property
    def daily_change_percent_float(self) -> float:
        """Get daily change percentage as float"""
        try:
            return float(self.daily_change_percent)
        except (ValueError, TypeError):
            return 0.0
    
    def get_asset_count(self) -> int:
        """Get total number of assets in portfolio"""
        return len(self.asset_breakdown) if self.asset_breakdown else 0
    
    def get_chain_count(self) -> int:
        """Get number of chains with assets"""
        return len(self.chain_breakdown) if self.chain_breakdown else 0
    
    def get_top_assets(self, limit: int = 5) -> list:
        """Get top assets by value"""
        if not self.asset_breakdown:
            return []
        
        # Sort assets by value
        assets = [
            {
                'symbol': symbol,
                'value_usd': float(data.get('value_usd', 0)),
                'amount': data.get('amount', '0'),
                'chain': data.get('chain', 'unknown')
            }
            for symbol, data in self.asset_breakdown.items()
        ]
        
        return sorted(assets, key=lambda x: x['value_usd'], reverse=True)[:limit]
    
    def get_chain_distribution(self) -> list:
        """Get portfolio distribution by chain"""
        if not self.chain_breakdown:
            return []
        
        total_value = self.total_value_float
        if total_value == 0:
            return []
        
        chains = []
        for chain_name, data in self.chain_breakdown.items():
            chain_value = float(data.get('total_value_usd', 0))
            percentage = (chain_value / total_value) * 100 if total_value > 0 else 0
            
            chains.append({
                'chain': chain_name,
                'value_usd': chain_value,
                'percentage': round(percentage, 2),
                'asset_count': data.get('asset_count', 0)
            })
        
        return sorted(chains, key=lambda x: x['value_usd'], reverse=True)
    
    def is_healthy_diversification(self) -> bool:
        """Check if portfolio has healthy diversification (no single asset > 50%)"""
        if not self.asset_breakdown or self.total_value_float == 0:
            return True
        
        total_value = self.total_value_float
        for asset_data in self.asset_breakdown.values():
            asset_value = float(asset_data.get('value_usd', 0))
            if (asset_value / total_value) > 0.5:  # 50% threshold
                return False
        
        return True
    
    def calculate_performance_vs_previous(self, previous_snapshot: 'PortfolioSnapshot') -> dict:
        """Calculate performance vs previous snapshot"""
        if not previous_snapshot:
            return {
                'change_usd': 0.0,
                'change_percent': 0.0,
                'period_hours': 0
            }
        
        current_value = self.total_value_float
        previous_value = previous_snapshot.total_value_float
        
        change_usd = current_value - previous_value
        change_percent = (change_usd / previous_value * 100) if previous_value > 0 else 0.0
        
        # Calculate time period
        time_diff = self.snapshot_at - previous_snapshot.snapshot_at
        period_hours = time_diff.total_seconds() / 3600
        
        return {
            'change_usd': round(change_usd, 2),
            'change_percent': round(change_percent, 2),
            'period_hours': round(period_hours, 2)
        }
    
    def to_dict(self):
        """Convert to dictionary with computed fields"""
        data = super().to_dict()
        data.update({
            'total_value_float': self.total_value_float,
            'daily_change_float': self.daily_change_float,
            'daily_change_percent_float': self.daily_change_percent_float,
            'asset_count': self.get_asset_count(),
            'chain_count': self.get_chain_count(),
            'top_assets': self.get_top_assets(),
            'chain_distribution': self.get_chain_distribution(),
            'is_healthy_diversification': self.is_healthy_diversification()
        })
        return data 