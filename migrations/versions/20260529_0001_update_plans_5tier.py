"""update plans 5tier

Revision ID: 20260529_0001
Revises: 002_full_schema
Create Date: 2026-05-29 00:01:00

"""
from typing import Sequence, Union
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
from alembic import op

revision: str = "20260529_0001"
down_revision: Union[str, None] = "002_full_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add missing columns if not present
    with op.batch_alter_table("plans") as batch_op:
        batch_op.add_column(sa.Column("channels_allowed", sa.Integer, nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("integrations_allowed", sa.Integer, nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("video_duration_limit_min", sa.Integer, nullable=True))
        batch_op.add_column(sa.Column("watermark", sa.Boolean, nullable=False, server_default="false"))

    op.execute(sa.text("DELETE FROM plans"))

    op.execute(sa.text("""
        INSERT INTO plans (
            id, name, price_monthly, price_yearly,
            videos_per_month, storage_gb, platforms_allowed,
            brainstorm_sessions, workflows_allowed,
            voice_clone, custom_llm_key, team_members,
            channels_allowed, integrations_allowed,
            video_duration_limit_min, watermark
        ) VALUES
        (
            '00000000-0000-0000-0000-000000000001', 'free', 0.00, 0.00,
            5, 1, 0,
            0, 0,
            false, false, 1,
            0, 0,
            20, true
        ),
        (
            '00000000-0000-0000-0000-000000000002', 'starter', 9.00, 90.00,
            15, 10, 3,
            0, 0,
            false, false, 1,
            0, 0,
            NULL, false
        ),
        (
            '00000000-0000-0000-0000-000000000003', 'pro', 19.00, 190.00,
            30, 20, 9,
            -1, -1,
            false, false, 3,
            0, 1,
            NULL, false
        ),
        (
            '00000000-0000-0000-0000-000000000004', 'creator', 35.00, 350.00,
            60, 40, 15,
            -1, -1,
            true, true, 5,
            -1, -1,
            NULL, false
        ),
        (
            '00000000-0000-0000-0000-000000000005', 'unlimited', 49.00, 490.00,
            -1, -1, -1,
            -1, -1,
            true, true, 10,
            -1, -1,
            NULL, false
        )
    """))


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM plans"))

    with op.batch_alter_table("plans") as batch_op:
        batch_op.drop_column("watermark")
        batch_op.drop_column("video_duration_limit_min")
        batch_op.drop_column("integrations_allowed")
        batch_op.drop_column("channels_allowed")
