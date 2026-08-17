"""admin panel — is_admin flag + magic link tokens

Revision ID: 20260817_0001
Revises: 20260720_0002
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260817_0001"
down_revision = "20260720_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.create_table(
        "admin_magic_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("used_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_unique_constraint(
        "uq_admin_magic_links_token_hash", "admin_magic_links", ["token_hash"]
    )
    op.create_index(
        "ix_admin_magic_links_email", "admin_magic_links", ["email"]
    )


def downgrade() -> None:
    op.drop_index("ix_admin_magic_links_email", table_name="admin_magic_links")
    op.drop_constraint("uq_admin_magic_links_token_hash", "admin_magic_links", type_="unique")
    op.drop_table("admin_magic_links")
    op.drop_column("users", "is_admin")
