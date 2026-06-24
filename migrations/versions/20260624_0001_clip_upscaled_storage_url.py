"""add upscaled_storage_url to clips

Revision ID: 20260624_0001
Revises: 20260619_0001
Create Date: 2026-06-24
"""
import sqlalchemy as sa
from alembic import op

revision = '20260624_0001'
down_revision = '20260619_0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("clips", sa.Column("upscaled_storage_url", sa.Text, nullable=True))


def downgrade() -> None:
    op.drop_column("clips", "upscaled_storage_url")
