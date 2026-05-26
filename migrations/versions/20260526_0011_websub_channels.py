"""websub: channel_subscriptions and websub_deliveries tables

Revision ID: 011_websub_channels
Revises: 20260526_0010_clip_async_upload
Create Date: 2026-05-26

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as sa_pg

revision = "011_websub_channels"
down_revision = "010_clip_async_upload"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "channel_subscriptions",
        sa.Column("id", sa_pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa_pg.UUID(as_uuid=True), nullable=False),
        sa.Column("channel_id", sa.VARCHAR(64), nullable=False),
        sa.Column("channel_name", sa.VARCHAR(255), nullable=True),
        sa.Column("channel_url", sa.Text(), nullable=True),
        sa.Column("auto_publish", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("auto_publish_config", sa_pg.JSONB(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("subscribed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("lease_expires_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("last_video_id", sa.VARCHAR(64), nullable=True),
        sa.Column("last_notified_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )

    op.create_index("ix_channel_subscriptions_tenant_id",
                    "channel_subscriptions", ["tenant_id"])
    op.create_index("ix_channel_subscriptions_channel_id",
                    "channel_subscriptions", ["channel_id"])

    op.create_table(
        "websub_deliveries",
        sa.Column("id", sa_pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("channel_id", sa.VARCHAR(64), nullable=False),
        sa.Column("video_id", sa.VARCHAR(64), nullable=False),
        sa.Column("raw_payload", sa.Text(), nullable=True),
        sa.Column("job_id", sa_pg.UUID(as_uuid=True), nullable=True),
        sa.Column("processed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("received_at", sa.TIMESTAMP(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("video_id", name="uq_websub_deliveries_video_id"),
    )

    op.create_index("ix_websub_deliveries_channel_id",
                    "websub_deliveries", ["channel_id"])


def downgrade() -> None:
    op.drop_index("ix_websub_deliveries_channel_id", table_name="websub_deliveries")
    op.drop_table("websub_deliveries")

    op.drop_index("ix_channel_subscriptions_channel_id", table_name="channel_subscriptions")
    op.drop_index("ix_channel_subscriptions_tenant_id", table_name="channel_subscriptions")
    op.drop_table("channel_subscriptions")
