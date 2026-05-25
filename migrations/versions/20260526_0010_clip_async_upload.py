"""clips: async upload columns — upload_attempts, upload_error, nullable storage_url, new status values

Revision ID: 010_clip_async_upload
Revises: 009_notifications_v2
Create Date: 2026-05-26

"""
from alembic import op
import sqlalchemy as sa

revision = "010_clip_async_upload"
down_revision = "009_notifications_v2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # storage_url was effectively required before; now null until upload completes
    op.alter_column("clips", "storage_url", nullable=True, existing_nullable=False,
                    existing_type=sa.Text())

    op.add_column("clips", sa.Column("upload_attempts", sa.Integer(), nullable=True,
                                     server_default="0"))
    op.add_column("clips", sa.Column("upload_error", sa.Text(), nullable=True))

    # Index to efficiently query clips still awaiting upload (monitoring/retries)
    op.create_index("ix_clips_status_pending",
                    "clips", ["status"],
                    postgresql_where=sa.text("status IN ('pending_upload', 'uploading', 'upload_failed')"))


def downgrade() -> None:
    op.drop_index("ix_clips_status_pending", table_name="clips")
    op.drop_column("clips", "upload_error")
    op.drop_column("clips", "upload_attempts")
    op.alter_column("clips", "storage_url", nullable=False, existing_nullable=True,
                    existing_type=sa.Text())
