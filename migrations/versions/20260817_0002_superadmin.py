"""superadmin — is_superadmin flag on users

Revision ID: 20260817_0002
Revises: 20260817_0001
"""

import sqlalchemy as sa
from alembic import op

revision = "20260817_0002"
down_revision = "20260817_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_superadmin", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("users", "is_superadmin")
