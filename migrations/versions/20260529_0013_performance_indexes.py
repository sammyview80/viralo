"""add performance indexes

Revision ID: 20260529_0013
Revises: 012_sched_post_runtime
Create Date: 2026-05-29
"""
from alembic import op

revision = '20260529_0013'
down_revision = '012_sched_post_runtime'
branch_labels = None
depends_on = None

def upgrade():
    # CONCURRENTLY requires running outside a transaction block
    op.execute("COMMIT")
    op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clips_tenant_status ON clips(tenant_id, status)")
    op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_videos_status ON videos(status)")
    op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_videos_tenant_status ON videos(tenant_id, status)")
    op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scheduled_posts_status_scheduled_at ON scheduled_posts(status, scheduled_at) WHERE status IN ('pending', 'scheduled')")

def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_clips_tenant_status")
    op.execute("DROP INDEX IF EXISTS idx_videos_status")
    op.execute("DROP INDEX IF EXISTS idx_videos_tenant_status")
    op.execute("DROP INDEX IF EXISTS idx_scheduled_posts_status_scheduled_at")
