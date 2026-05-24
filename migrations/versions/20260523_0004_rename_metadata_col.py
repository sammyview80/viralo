"""rename agent_messages.metadata to msg_metadata

Revision ID: 005_rename_metadata_col
Revises: 004_agent_messages
Create Date: 2026-05-23

"""
from alembic import op

revision = "005_rename_metadata_col"
down_revision = "004_agent_messages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE agent_messages RENAME COLUMN metadata TO msg_metadata")


def downgrade() -> None:
    op.execute("ALTER TABLE agent_messages RENAME COLUMN msg_metadata TO metadata")
