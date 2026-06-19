"""add brand_kit, notification_prefs to tenant; create tenant_api_keys table

Revision ID: 20260619_0001
Revises: 20260529_0014
Create Date: 2026-06-19
"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID
from alembic import op

revision = '20260619_0001'
down_revision = '20260529_0014'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tenants", sa.Column("brand_kit", JSONB, nullable=True))
    op.add_column("tenants", sa.Column("notification_prefs", JSONB, nullable=True))

    op.create_table(
        "tenant_api_keys",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("key_prefix", sa.String(20), nullable=False),  # "vk_live_…XXXX" = ~16 chars
        sa.Column("key_hash", sa.String(64), nullable=False),
        sa.Column("last_used_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_tenant_api_keys_tenant_id", "tenant_api_keys", ["tenant_id"])


def downgrade() -> None:
    op.drop_table("tenant_api_keys")
    op.drop_column("tenants", "notification_prefs")
    op.drop_column("tenants", "brand_kit")
