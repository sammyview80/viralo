"""faceless-video series tables

Revision ID: 20260711_0001
Revises: 20260624_0002
Create Date: 2026-07-11
"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB
from alembic import op

revision = '20260711_0001'
down_revision = '20260624_0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "series",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        # Content config
        sa.Column("niche", sa.String(64), nullable=False),          # preset key or "custom"
        sa.Column("custom_prompt", sa.Text, nullable=True),          # custom niche description
        sa.Column("example_script", sa.Text, nullable=True),
        sa.Column("language", sa.String(16), nullable=False, server_default="en"),
        sa.Column("voice", sa.String(64), nullable=False, server_default="en-US-GuyNeural"),  # edge-tts voice
        sa.Column("music_track", sa.String(32), nullable=True),      # MUSIC_TRACKS key or null
        sa.Column("art_style", sa.String(64), nullable=False, server_default="comic"),
        sa.Column("caption_style", sa.String(32), nullable=False, server_default="capcut"),
        sa.Column("effects", JSONB, nullable=False, server_default="{}"),
        sa.Column("duration_sec", sa.Integer, nullable=False, server_default="65"),
        # Publishing config
        sa.Column("social_account_ids", JSONB, nullable=False, server_default="[]"),
        sa.Column("publish_time", sa.String(5), nullable=False, server_default="18:00"),  # HH:MM UTC
        sa.Column("cadence", sa.String(16), nullable=False, server_default="daily"),      # daily|3x_week|weekly
        sa.Column("auto_publish", sa.Boolean, nullable=False, server_default="true"),
        # Run state
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_series_due", "series", ["is_active", "next_run_at"])


def downgrade() -> None:
    op.drop_index("ix_series_due", table_name="series")
    op.drop_table("series")
