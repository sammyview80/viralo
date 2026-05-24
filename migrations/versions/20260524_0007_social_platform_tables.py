"""social platform tables

Revision ID: 008_social_platform_tables
Revises: 007_video_clip_config
Create Date: 2026-05-24

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

# revision identifiers, used by Alembic.
revision = "008_social_platform_tables"
down_revision = "007_video_clip_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A) Create social_accounts table
    op.create_table(
        "social_accounts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("platform", sa.String(20), nullable=False),
        sa.Column("platform_user_id", sa.String(255), nullable=False),
        sa.Column("platform_username", sa.String(255), nullable=True),
        sa.Column("access_token_enc", sa.Text(), nullable=False),
        sa.Column("refresh_token_enc", sa.Text(), nullable=True),
        sa.Column("token_expires_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("scope", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.UniqueConstraint("tenant_id", "platform", "platform_user_id", name="uq_social_accounts_tenant_platform_user"),
    )
    op.create_index("ix_social_accounts_tenant_id", "social_accounts", ["tenant_id"])

    op.execute("ALTER TABLE social_accounts ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE social_accounts FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON social_accounts
        USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    """)

    # B) Create scheduled_posts table
    op.create_table(
        "scheduled_posts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("clip_id", UUID(as_uuid=True), sa.ForeignKey("clips.id"), nullable=False),
        sa.Column("social_account_id", UUID(as_uuid=True), sa.ForeignKey("social_accounts.id"), nullable=False),
        sa.Column("platform", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("scheduled_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("posted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("platform_post_id", sa.String(255), nullable=True),
        sa.Column("caption", sa.Text(), nullable=True),
        sa.Column("hashtags", JSONB, server_default=sa.text("'[]'")),
        sa.Column("retry_count", sa.SmallInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("metadata", JSONB, nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=True),
    )
    op.create_index("ix_scheduled_posts_tenant_id", "scheduled_posts", ["tenant_id"])
    op.create_index("ix_scheduled_posts_tenant_status_scheduled", "scheduled_posts", ["tenant_id", "status", "scheduled_at"])
    op.create_index("ix_scheduled_posts_tenant_clip", "scheduled_posts", ["tenant_id", "clip_id"])

    op.execute("ALTER TABLE scheduled_posts ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE scheduled_posts FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON scheduled_posts
        USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    """)

    # C) Create analytics_events table
    op.create_table(
        "analytics_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("scheduled_post_id", UUID(as_uuid=True), sa.ForeignKey("scheduled_posts.id"), nullable=True),
        sa.Column("platform", sa.String(20), nullable=False),
        sa.Column("platform_post_id", sa.String(255), nullable=False),
        sa.Column("views", sa.BigInteger(), server_default=sa.text("0")),
        sa.Column("likes", sa.Integer(), server_default=sa.text("0")),
        sa.Column("comments", sa.Integer(), server_default=sa.text("0")),
        sa.Column("shares", sa.Integer(), server_default=sa.text("0")),
        sa.Column("saves", sa.Integer(), server_default=sa.text("0")),
        sa.Column("reach", sa.Integer(), server_default=sa.text("0")),
        sa.Column("impressions", sa.Integer(), server_default=sa.text("0")),
        sa.Column("engagement_rate", sa.Numeric(6, 4), nullable=True),
        sa.Column("fetched_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=True),
    )
    op.create_index("ix_analytics_events_tenant_id", "analytics_events", ["tenant_id"])
    op.create_index("ix_analytics_events_tenant_platform_post", "analytics_events", ["tenant_id", "platform_post_id"])

    op.execute("ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE analytics_events FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON analytics_events
        USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    """)

    # D) Create analytics_snapshots table
    op.create_table(
        "analytics_snapshots",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("scheduled_post_id", UUID(as_uuid=True), sa.ForeignKey("scheduled_posts.id"), nullable=True),
        sa.Column("platform", sa.String(20), nullable=False),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("views", sa.BigInteger(), server_default=sa.text("0")),
        sa.Column("likes", sa.Integer(), server_default=sa.text("0")),
        sa.Column("comments", sa.Integer(), server_default=sa.text("0")),
        sa.Column("shares", sa.Integer(), server_default=sa.text("0")),
        sa.Column("engagement_rate", sa.Numeric(6, 4), nullable=True),
        sa.Column("virality_score", sa.Numeric(5, 2), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.UniqueConstraint("tenant_id", "scheduled_post_id", "snapshot_date", name="uq_analytics_snapshots_tenant_post_date"),
    )
    op.create_index("ix_analytics_snapshots_tenant_id", "analytics_snapshots", ["tenant_id"])

    op.execute("ALTER TABLE analytics_snapshots ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE analytics_snapshots FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON analytics_snapshots
        USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    """)

    # E) Create notifications table
    op.create_table(
        "notifications",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("metadata", JSONB, nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=True),
    )
    op.create_index("ix_notifications_tenant_id", "notifications", ["tenant_id"])
    op.create_index(
        "ix_notifications_tenant_read_created",
        "notifications",
        ["tenant_id", "is_read", sa.text("created_at DESC")],
    )

    op.execute("ALTER TABLE notifications ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE notifications FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON notifications
        USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    """)


def downgrade() -> None:
    # Drop notifications
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON notifications")
    op.drop_index("ix_notifications_tenant_read_created", table_name="notifications")
    op.drop_index("ix_notifications_tenant_id", table_name="notifications")
    op.drop_table("notifications")

    # Drop analytics_snapshots
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON analytics_snapshots")
    op.drop_index("ix_analytics_snapshots_tenant_id", table_name="analytics_snapshots")
    op.drop_table("analytics_snapshots")

    # Drop analytics_events
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON analytics_events")
    op.drop_index("ix_analytics_events_tenant_platform_post", table_name="analytics_events")
    op.drop_index("ix_analytics_events_tenant_id", table_name="analytics_events")
    op.drop_table("analytics_events")

    # Drop scheduled_posts
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON scheduled_posts")
    op.drop_index("ix_scheduled_posts_tenant_clip", table_name="scheduled_posts")
    op.drop_index("ix_scheduled_posts_tenant_status_scheduled", table_name="scheduled_posts")
    op.drop_index("ix_scheduled_posts_tenant_id", table_name="scheduled_posts")
    op.drop_table("scheduled_posts")

    # Drop social_accounts
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON social_accounts")
    op.drop_index("ix_social_accounts_tenant_id", table_name="social_accounts")
    op.drop_table("social_accounts")
