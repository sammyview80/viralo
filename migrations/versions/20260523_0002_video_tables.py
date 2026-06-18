"""video tables

Revision ID: 003_video_tables
Revises: 002_full_schema
Create Date: 2026-05-23

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

# revision identifiers, used by Alembic.
revision = "003_video_tables"
down_revision = "002_full_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A) Add columns to existing clips table
    op.add_column("clips", sa.Column("start_ms", sa.Integer(), nullable=True))
    op.add_column("clips", sa.Column("end_ms", sa.Integer(), nullable=True))
    op.add_column("clips", sa.Column("platform", sa.String(20), nullable=True))
    op.add_column("clips", sa.Column("score", sa.Numeric(5, 2), nullable=True))
    op.add_column("clips", sa.Column("duration_ms", sa.Integer(), nullable=True))
    op.add_column("clips", sa.Column("thumbnail_url", sa.Text(), nullable=True))
    op.add_column("clips", sa.Column("metadata", JSONB, nullable=True))

    # B) Add columns to existing videos table
    op.add_column("videos", sa.Column("step_artifacts", JSONB, nullable=True))
    op.add_column("videos", sa.Column("source_url", sa.Text(), nullable=True))
    op.add_column("videos", sa.Column("original_storage_key", sa.Text(), nullable=True))
    op.add_column("videos", sa.Column("thumbnail_url", sa.Text(), nullable=True))
    op.add_column("videos", sa.Column("resolution", sa.String(20), nullable=True))
    op.add_column("videos", sa.Column("metadata", JSONB, nullable=True))

    # C) Create transcripts table
    op.create_table(
        "transcripts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("video_id", UUID(as_uuid=True), sa.ForeignKey("videos.id"), nullable=False),
        sa.Column("language", sa.String(10), nullable=False, server_default="en"),
        sa.Column("segments", JSONB, nullable=True),
        sa.Column("full_text", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("video_id", name="uq_transcripts_video_id"),
    )
    op.create_index("ix_transcripts_tenant_id", "transcripts", ["tenant_id"])
    op.create_index("ix_transcripts_tenant_video", "transcripts", ["tenant_id", "video_id"])

    op.execute("ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE transcripts FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON transcripts
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    """)

    # D) Create captions table
    op.create_table(
        "captions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("clip_id", UUID(as_uuid=True), sa.ForeignKey("clips.id"), nullable=False),
        sa.Column("style", sa.String(20), nullable=False, server_default="pop_on"),
        sa.Column("segments", JSONB, nullable=True),
        sa.Column("font", sa.String(100), nullable=False, server_default="Montserrat"),
        sa.Column("color", sa.String(7), nullable=False, server_default="#FFFFFF"),
        sa.Column("bg_color", sa.String(7), nullable=True),
        sa.Column("position", sa.String(20), nullable=False, server_default="bottom"),
        sa.Column("font_size", sa.Integer(), nullable=False, server_default="48"),
        sa.Column("bold", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_captions_tenant_id", "captions", ["tenant_id"])
    op.create_index("ix_captions_tenant_clip", "captions", ["tenant_id", "clip_id"])

    op.execute("ALTER TABLE captions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE captions FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON captions
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    """)


def downgrade() -> None:
    # Drop captions
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON captions")
    op.drop_index("ix_captions_tenant_clip", table_name="captions")
    op.drop_index("ix_captions_tenant_id", table_name="captions")
    op.drop_table("captions")

    # Drop transcripts
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON transcripts")
    op.drop_index("ix_transcripts_tenant_video", table_name="transcripts")
    op.drop_index("ix_transcripts_tenant_id", table_name="transcripts")
    op.drop_table("transcripts")

    # Remove added columns from videos
    op.drop_column("videos", "metadata")
    op.drop_column("videos", "resolution")
    op.drop_column("videos", "thumbnail_url")
    op.drop_column("videos", "original_storage_key")
    op.drop_column("videos", "source_url")
    op.drop_column("videos", "step_artifacts")

    # Remove added columns from clips
    op.drop_column("clips", "metadata")
    op.drop_column("clips", "thumbnail_url")
    op.drop_column("clips", "duration_ms")
    op.drop_column("clips", "score")
    op.drop_column("clips", "platform")
    op.drop_column("clips", "end_ms")
    op.drop_column("clips", "start_ms")
