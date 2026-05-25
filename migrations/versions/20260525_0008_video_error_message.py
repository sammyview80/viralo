"""add videos.error_message text

Revision ID: 008_video_error_message
Revises: 007_video_clip_config
Create Date: 2026-05-25

"""
from alembic import op
import sqlalchemy as sa

revision = "008_video_error_message"
down_revision = "007_video_clip_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("videos", sa.Column("error_message", sa.Text, nullable=True))


def downgrade() -> None:
    op.drop_column("videos", "error_message")
