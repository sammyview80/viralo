"""add videos.clip_config jsonb

Revision ID: 007_video_clip_config
Revises: 006_deferred_tenant_onboarding
Create Date: 2026-05-24

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "007_video_clip_config"
down_revision = "006_deferred_tenant_onboarding"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("videos", sa.Column("clip_config", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("videos", "clip_config")
