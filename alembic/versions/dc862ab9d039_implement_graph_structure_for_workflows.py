"""Implement graph structure for workflows

Revision ID: dc862ab9d039
Revises: b9a4fc8ac70d
Create Date: 2025-06-16 21:17:25.156872

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'dc862ab9d039'
down_revision: Union[str, None] = 'b9a4fc8ac70d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.alter_column('workflows', 'nodes',
               existing_type=postgresql.JSONB(astext_type=sa.Text()),
               comment="List of nodes in the graph. Each node is a dict with: {'id': str, 'type': str (e.g., 'swap', 'condition'), 'config': dict}",
               existing_nullable=False)
    op.alter_column('workflows', 'edges',
               existing_type=postgresql.JSONB(astext_type=sa.Text()),
               comment="List of edges connecting nodes. Each edge is a dict with: {'source': str (node_id), 'target': str (node_id), 'label': str (e.g., 'on_true', 'on_false', 'default')}",
               existing_nullable=False)
    op.drop_index('idx_workflow_action_config', table_name='workflows', postgresql_using='gin')
    op.drop_index('idx_workflow_action_type', table_name='workflows')
    op.drop_index('ix_workflows_action_type', table_name='workflows')
    op.drop_index('ix_workflows_commitment_hash', table_name='workflows')
    op.create_index('idx_workflow_edges', 'workflows', ['edges'], unique=False, postgresql_using='gin')
    op.create_index('idx_workflow_nodes', 'workflows', ['nodes'], unique=False, postgresql_using='gin')
    op.drop_column('workflows', 'commitment_hash')
    op.drop_column('workflows', 'action_config')
    op.drop_column('workflows', 'execution_grant')
    op.drop_column('workflows', 'action_type')
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.add_column('workflows', sa.Column('action_type', sa.VARCHAR(length=50), autoincrement=False, nullable=False))
    op.add_column('workflows', sa.Column('execution_grant', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=True))
    op.add_column('workflows', sa.Column('action_config', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=False))
    op.add_column('workflows', sa.Column('commitment_hash', sa.VARCHAR(), autoincrement=False, nullable=True, comment='keccak256 hash of the off-chain action payload.'))
    op.drop_index('idx_workflow_nodes', table_name='workflows', postgresql_using='gin')
    op.drop_index('idx_workflow_edges', table_name='workflows', postgresql_using='gin')
    op.create_index('ix_workflows_commitment_hash', 'workflows', ['commitment_hash'], unique=True)
    op.create_index('ix_workflows_action_type', 'workflows', ['action_type'], unique=False)
    op.create_index('idx_workflow_action_type', 'workflows', ['action_type'], unique=False)
    op.create_index('idx_workflow_action_config', 'workflows', ['action_config'], unique=False, postgresql_using='gin')
    op.alter_column('workflows', 'edges',
               existing_type=postgresql.JSONB(astext_type=sa.Text()),
               comment=None,
               existing_comment="List of edges connecting nodes. Each edge is a dict with: {'source': str (node_id), 'target': str (node_id), 'label': str (e.g., 'on_true', 'on_false', 'default')}",
               existing_nullable=False)
    op.alter_column('workflows', 'nodes',
               existing_type=postgresql.JSONB(astext_type=sa.Text()),
               comment=None,
               existing_comment="List of nodes in the graph. Each node is a dict with: {'id': str, 'type': str (e.g., 'swap', 'condition'), 'config': dict}",
               existing_nullable=False)
    # ### end Alembic commands ###
