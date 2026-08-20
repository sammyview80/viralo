"""add tenants.webhook_config for video success/failure webhooks

Revision ID: 20260820_0001
Revises: 20260819_0001
Create Date: 2026-08-20

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260820_0001"
down_revision = "20260819_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tenants", sa.Column("webhook_config", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("tenants", "webhook_config")
