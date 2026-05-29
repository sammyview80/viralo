"""scheduled_posts: runtime publish fields

Revision ID: 012_sched_post_runtime
Revises: 011_websub_channels
Create Date: 2026-05-26

"""
from alembic import op


revision = "012_sched_post_runtime"
down_revision = "011_websub_channels"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS platform_kwargs JSONB")
    op.execute("ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS clip_storage_url TEXT")
    op.execute("ALTER TABLE scheduled_posts ALTER COLUMN clip_id DROP NOT NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE scheduled_posts DROP COLUMN IF EXISTS clip_storage_url")
    op.execute("ALTER TABLE scheduled_posts DROP COLUMN IF EXISTS platform_kwargs")
    op.execute("ALTER TABLE scheduled_posts ALTER COLUMN clip_id SET NOT NULL")
