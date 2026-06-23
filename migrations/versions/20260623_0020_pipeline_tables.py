"""Add speaker_segments, topic_blocks, scene_frames, clip_score_feedback tables

Revision ID: 20260623_0020
Revises: 20260619_0001_settings_fields
Create Date: 2026-06-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = '20260623_0020'
down_revision = '20260619_0001'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'speaker_segments',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('video_id', UUID(as_uuid=True), sa.ForeignKey('videos.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('speaker_id', sa.String(20), nullable=False),
        sa.Column('start_sec', sa.Numeric(8, 2), nullable=False),
        sa.Column('end_sec', sa.Numeric(8, 2), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        'topic_blocks',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('video_id', UUID(as_uuid=True), sa.ForeignKey('videos.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('block_index', sa.SmallInteger, nullable=False),
        sa.Column('topic', sa.String(255), nullable=True),
        sa.Column('keywords', JSONB, nullable=True),
        sa.Column('start_sec', sa.Numeric(8, 2), nullable=False),
        sa.Column('end_sec', sa.Numeric(8, 2), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        'scene_frames',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('video_id', UUID(as_uuid=True), sa.ForeignKey('videos.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('time_sec', sa.Numeric(8, 2), nullable=False),
        sa.Column('storage_url', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        'clip_score_feedback',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('clip_id', UUID(as_uuid=True), sa.ForeignKey('clips.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('video_id', UUID(as_uuid=True), sa.ForeignKey('videos.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('action', sa.String(20), nullable=False),  # 'approve'|'reject'|'edit_boundary'|'export'
        sa.Column('original_start', sa.Numeric(8, 2), nullable=True),
        sa.Column('original_end', sa.Numeric(8, 2), nullable=True),
        sa.Column('edited_start', sa.Numeric(8, 2), nullable=True),
        sa.Column('edited_end', sa.Numeric(8, 2), nullable=True),
        sa.Column('original_score', sa.Numeric(5, 2), nullable=True),
        sa.Column('clip_signals', JSONB, nullable=True),  # hook_score, audio_energy, etc.
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade():
    op.drop_table('clip_score_feedback')
    op.drop_table('scene_frames')
    op.drop_table('topic_blocks')
    op.drop_table('speaker_segments')
