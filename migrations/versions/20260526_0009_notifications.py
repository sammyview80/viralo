"""notifications v2 — user_id, action_url, read_at, push_subscriptions, tenant notif prefs

Revision ID: 009_notifications_v2
Revises: 008_video_error_message
Create Date: 2026-05-26

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as sa_pg
from sqlalchemy.dialects.postgresql import UUID, ARRAY, TEXT

revision = "009_notifications_v2"
down_revision = ("008_video_error_message", "008_social_platform_tables")
branch_labels = None
depends_on = None


def _apply_rls(table_name: str) -> None:
    op.execute(f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table_name} FORCE ROW LEVEL SECURITY")
    op.execute(f"""
        CREATE POLICY tenant_isolation ON {table_name}
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)
    """)


def upgrade() -> None:
    op.add_column("notifications", sa.Column("user_id", UUID(as_uuid=True), nullable=True))
    op.add_column("notifications", sa.Column("action_url", sa.Text(), nullable=True))
    op.add_column("notifications", sa.Column("read_at", sa.TIMESTAMP(timezone=True), nullable=True))
    op.execute("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata JSONB")

    op.create_table(
        "push_subscriptions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False, unique=True),
        sa.Column("p256dh", sa.Text(), nullable=False),
        sa.Column("auth", sa.Text(), nullable=False),
        sa.Column("user_agent", sa.String(255), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_push_subscriptions_tenant_user", "push_subscriptions", ["tenant_id", "user_id"])

    _apply_rls("push_subscriptions")

    op.add_column("tenants", sa.Column("notif_email_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")))
    op.add_column("tenants", sa.Column("notif_push_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")))
    op.add_column("tenants", sa.Column("notif_types_disabled", ARRAY(TEXT), nullable=False, server_default=sa.text("'{}'")))


def downgrade() -> None:
    op.drop_column("tenants", "notif_types_disabled")
    op.drop_column("tenants", "notif_push_enabled")
    op.drop_column("tenants", "notif_email_enabled")

    op.execute("DROP POLICY IF EXISTS tenant_isolation ON push_subscriptions")
    op.drop_index("ix_push_subscriptions_tenant_user", table_name="push_subscriptions")
    op.drop_table("push_subscriptions")

    op.drop_column("notifications", "read_at")
    op.drop_column("notifications", "action_url")
    op.drop_column("notifications", "user_id")
