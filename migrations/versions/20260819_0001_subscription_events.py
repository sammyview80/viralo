"""subscription_events — audit log for plan/status changes

Revision ID: 20260819_0001
Revises: 20260818_0001
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260819_0001"
down_revision = "20260818_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "subscription_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("subscription_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(length=20), nullable=False),
        sa.Column("from_plan_name", sa.String(length=50), nullable=True),
        sa.Column("to_plan_name", sa.String(length=50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["subscription_id"], ["subscriptions.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_subscription_events_type_created_at", "subscription_events", ["event_type", "created_at"]
    )
    op.create_index(
        "ix_subscription_events_tenant_id", "subscription_events", ["tenant_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_subscription_events_tenant_id", table_name="subscription_events")
    op.drop_index("ix_subscription_events_type_created_at", table_name="subscription_events")
    op.drop_table("subscription_events")
