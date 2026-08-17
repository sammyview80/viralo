"""admin notifications — new-signup alerts feed

Revision ID: 20260818_0001
Revises: 20260817_0002
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260818_0001"
down_revision = "20260817_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "admin_notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("type", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("related_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["related_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index(
        "ix_admin_notifications_type_is_read", "admin_notifications", ["type", "is_read"]
    )
    op.create_index(
        "ix_admin_notifications_created_at", "admin_notifications", ["created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_admin_notifications_created_at", table_name="admin_notifications")
    op.drop_index("ix_admin_notifications_type_is_read", table_name="admin_notifications")
    op.drop_table("admin_notifications")
