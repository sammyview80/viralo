"""make scheduled series dispatch recoverable and idempotent

Revision ID: 20260720_0002
Revises: 20260720_0001
"""

import sqlalchemy as sa
from alembic import op

revision = "20260720_0002"
down_revision = "20260720_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("series", sa.Column("dispatch_pending_at", sa.DateTime(timezone=True)))
    op.add_column("videos", sa.Column("series_run_key", sa.String(length=200)))
    op.create_unique_constraint("uq_videos_series_run_key", "videos", ["series_run_key"])


def downgrade() -> None:
    op.drop_constraint("uq_videos_series_run_key", "videos", type_="unique")
    op.drop_column("videos", "series_run_key")
    op.drop_column("series", "dispatch_pending_at")
