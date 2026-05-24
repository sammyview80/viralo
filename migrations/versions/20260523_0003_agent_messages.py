"""agent messages

Revision ID: 004_agent_messages
Revises: 003_video_tables
Create Date: 2026-05-23

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "004_agent_messages"
down_revision = "003_video_tables"
branch_labels = None
depends_on = None


def _apply_rls(table: str) -> None:
    op.execute(sa.text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"))
    op.execute(sa.text(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY"))
    op.execute(sa.text(
        f"CREATE POLICY tenant_isolation ON {table} "
        f"USING (tenant_id = current_setting('app.current_tenant', true)::uuid)"
    ))
    op.execute(sa.text(
        f"CREATE POLICY tenant_insert ON {table} FOR INSERT "
        f"WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)"
    ))


def upgrade() -> None:
    op.create_table(
        "agent_messages",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("session_id", UUID(as_uuid=True), sa.ForeignKey("brainstorm_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent", sa.String(50), nullable=False),
        sa.Column("msg_type", sa.String(30), nullable=False, server_default="agent_message"),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("metadata", JSONB, nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("ix_agent_messages_session_id", "agent_messages", ["session_id"])
    op.create_index("ix_agent_messages_tenant_id", "agent_messages", ["tenant_id"])
    _apply_rls("agent_messages")


def downgrade() -> None:
    op.drop_table("agent_messages")
