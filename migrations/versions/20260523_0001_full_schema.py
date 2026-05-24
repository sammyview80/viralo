"""full schema

Revision ID: 002_full_schema
Revises: 001_initial
Create Date: 2026-05-23 00:01:00

"""
from typing import Sequence, Union
import uuid
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY
from alembic import op

revision: str = "002_full_schema"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


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
    # ------------------------------------------------------------------
    # Drop legacy tenants table created in 001_initial (different schema)
    # ------------------------------------------------------------------
    op.drop_table("tenants")

    # ------------------------------------------------------------------
    # plans
    # ------------------------------------------------------------------
    op.create_table(
        "plans",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(50), nullable=False),
        sa.Column("price_monthly", sa.Numeric(10, 2), nullable=False),
        sa.Column("price_yearly", sa.Numeric(10, 2), nullable=False),
        sa.Column("stripe_price_id_mo", sa.String(100), nullable=True),
        sa.Column("stripe_price_id_yr", sa.String(100), nullable=True),
        sa.Column("videos_per_month", sa.Integer, nullable=False),
        sa.Column("platforms_allowed", sa.Integer, nullable=False),
        sa.Column("brainstorm_sessions", sa.Integer, nullable=False),
        sa.Column("workflows_allowed", sa.Integer, nullable=False),
        sa.Column("voice_clone", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("custom_llm_key", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("storage_gb", sa.Integer, nullable=False),
        sa.Column("team_members", sa.Integer, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )

    # ------------------------------------------------------------------
    # Seed plans
    # ------------------------------------------------------------------
    plans_table = sa.table(
        "plans",
        sa.column("id", UUID(as_uuid=True)),
        sa.column("name", sa.String),
        sa.column("price_monthly", sa.Numeric),
        sa.column("price_yearly", sa.Numeric),
        sa.column("videos_per_month", sa.Integer),
        sa.column("platforms_allowed", sa.Integer),
        sa.column("brainstorm_sessions", sa.Integer),
        sa.column("workflows_allowed", sa.Integer),
        sa.column("voice_clone", sa.Boolean),
        sa.column("custom_llm_key", sa.Boolean),
        sa.column("storage_gb", sa.Integer),
        sa.column("team_members", sa.Integer),
    )
    op.bulk_insert(plans_table, [
        {
            "id": uuid.UUID("00000000-0000-0000-0000-000000000001"),
            "name": "free",
            "price_monthly": "0.00",
            "price_yearly": "0.00",
            "videos_per_month": 5,
            "platforms_allowed": 2,
            "brainstorm_sessions": 3,
            "workflows_allowed": 1,
            "voice_clone": False,
            "custom_llm_key": False,
            "storage_gb": 2,
            "team_members": 1,
        },
        {
            "id": uuid.UUID("00000000-0000-0000-0000-000000000002"),
            "name": "pro",
            "price_monthly": "29.00",
            "price_yearly": "290.00",
            "videos_per_month": 50,
            "platforms_allowed": 5,
            "brainstorm_sessions": 30,
            "workflows_allowed": 10,
            "voice_clone": True,
            "custom_llm_key": True,
            "storage_gb": 50,
            "team_members": 3,
        },
        {
            "id": uuid.UUID("00000000-0000-0000-0000-000000000003"),
            "name": "agency",
            "price_monthly": "99.00",
            "price_yearly": "990.00",
            "videos_per_month": -1,
            "platforms_allowed": -1,
            "brainstorm_sessions": -1,
            "workflows_allowed": -1,
            "voice_clone": True,
            "custom_llm_key": True,
            "storage_gb": 500,
            "team_members": 20,
        },
    ])

    # ------------------------------------------------------------------
    # tenants (full schema)
    # ------------------------------------------------------------------
    op.create_table(
        "tenants",
        sa.Column("id", UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("subdomain", sa.String(63), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("plan_id", UUID(as_uuid=True), sa.ForeignKey("plans.id"), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("storage_provider", sa.String(20), nullable=False, server_default="cloudinary"),
        sa.Column("llm_provider", sa.String(20), nullable=False, server_default="google"),
        sa.Column("llm_api_key_enc", sa.Text, nullable=True),
        sa.Column("llm_model", sa.String(100), nullable=True),
        sa.Column("timezone", sa.String(50), nullable=False, server_default="UTC"),
        sa.Column("niche", sa.String(100), nullable=True),
        sa.Column("goal", sa.String(20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("subdomain"),
        sa.ForeignKeyConstraint(["plan_id"], ["plans.id"]),
    )

    # ------------------------------------------------------------------
    # users
    # ------------------------------------------------------------------
    op.create_table(
        "users",
        sa.Column("id", UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=True),
        sa.Column("google_sub", sa.String(255), nullable=True),
        sa.Column("full_name", sa.String(255), nullable=True),
        sa.Column("avatar_url", sa.Text, nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("is_verified", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("onboarding_step", sa.SmallInteger, nullable=True, server_default="0"),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id"),
        sa.UniqueConstraint("email"),
        sa.UniqueConstraint("google_sub"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
    )

    # ------------------------------------------------------------------
    # subscriptions
    # ------------------------------------------------------------------
    op.create_table(
        "subscriptions",
        sa.Column("id", UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("plan_id", UUID(as_uuid=True), nullable=False),
        sa.Column("stripe_subscription_id", sa.String(100), nullable=True),
        sa.Column("stripe_customer_id", sa.String(100), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("billing_cycle", sa.String(10), nullable=False, server_default="monthly"),
        sa.Column("current_period_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancel_at_period_end", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("stripe_subscription_id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["plan_id"], ["plans.id"]),
    )
    op.create_index("ix_subscriptions_tenant_id", "subscriptions", ["tenant_id"])
    op.create_index("ix_subscriptions_stripe_customer_id", "subscriptions", ["stripe_customer_id"])
    op.create_index("ix_subscriptions_current_period_end", "subscriptions", ["current_period_end"])

    # ------------------------------------------------------------------
    # usage_quotas
    # ------------------------------------------------------------------
    op.create_table(
        "usage_quotas",
        sa.Column("id", UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("period_start", sa.Date, nullable=True),
        sa.Column("videos_used", sa.Integer, nullable=False, server_default="0"),
        sa.Column("storage_bytes_used", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("brainstorm_used", sa.Integer, nullable=False, server_default="0"),
        sa.Column("api_calls_used", sa.Integer, nullable=False, server_default="0"),
        sa.Column("llm_tokens_used", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
    )

    # ------------------------------------------------------------------
    # node_definitions (not a tenant table — global, no RLS)
    # ------------------------------------------------------------------
    op.create_table(
        "node_definitions",
        sa.Column("id", UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("node_type", sa.String(100), nullable=False),
        sa.Column("category", sa.String(20), nullable=False),
        sa.Column("display_name", sa.String(100), nullable=False),
        sa.Column("input_schema", JSONB, nullable=True),
        sa.Column("output_schema", JSONB, nullable=True),
        sa.Column("handler_path", sa.String(255), nullable=False),
        sa.Column("is_trigger", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_async", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("plan_required", sa.String(10), nullable=False, server_default="free"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("node_type"),
    )

    # ------------------------------------------------------------------
    # Tenant tables
    # ------------------------------------------------------------------

    # videos
    op.create_table(
        "videos",
        sa.Column("id", UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(255), nullable=True),
        sa.Column("topic", sa.Text, nullable=True),
        sa.Column("source_type", sa.String(20), nullable=True, server_default="ai_generated"),
        sa.Column("status", sa.String(20), nullable=True, server_default="queued"),
        sa.Column("pipeline_step", sa.String(50), nullable=True),
        sa.Column("pipeline_pct", sa.SmallInteger, nullable=True, server_default="0"),
        sa.Column("celery_task_id", sa.String(50), nullable=True),
        sa.Column("storage_url", sa.Text, nullable=True),
        sa.Column("storage_provider", sa.String(20), nullable=True),
        sa.Column("duration_sec", sa.SmallInteger, nullable=True),
        sa.Column("script_text", sa.Text, nullable=True),
        sa.Column("llm_tokens_used", sa.Integer, nullable=True, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
    )
    op.create_index("ix_videos_celery_task_id", "videos", ["celery_task_id"])
    op.create_index("ix_videos_tenant_id_status", "videos", ["tenant_id", "status"])
    op.create_index("ix_videos_tenant_id_created_at", "videos", ["tenant_id", sa.text("created_at DESC")])
    _apply_rls("videos")

    # clips
    op.create_table(
        "clips",
        sa.Column("id", UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("video_id", UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.String(255), nullable=True),
        sa.Column("start_sec", sa.Numeric(8, 2), nullable=True),
        sa.Column("end_sec", sa.Numeric(8, 2), nullable=True),
        sa.Column("status", sa.String(20), nullable=True, server_default="pending"),
        sa.Column("storage_url", sa.Text, nullable=True),
        sa.Column("caption_srt", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["video_id"], ["videos.id"]),
    )
    op.create_index("ix_clips_tenant_id_video_id", "clips", ["tenant_id", "video_id"])
    _apply_rls("clips")

    # brainstorm_sessions
    op.create_table(
        "brainstorm_sessions",
        sa.Column("id", UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("topic", sa.Text, nullable=False),
        sa.Column("status", sa.String(20), nullable=True, server_default="draft"),
        sa.Column("langgraph_thread_id", sa.String(100), nullable=True),
        sa.Column("langgraph_checkpoint", JSONB, nullable=True),
        sa.Column("current_agent", sa.String(50), nullable=True),
        sa.Column("agents_completed", ARRAY(sa.String), nullable=True),
        sa.Column("niche_verdict", sa.Text, nullable=True),
        sa.Column("video_ideas", JSONB, nullable=True),
        sa.Column("generated_workflow_id", UUID(as_uuid=True), nullable=True),
        sa.Column("generated_video_id", UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("langgraph_thread_id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
    )
    op.create_index("ix_brainstorm_sessions_tenant_id_status", "brainstorm_sessions", ["tenant_id", "status"])
    _apply_rls("brainstorm_sessions")

    # workflows
    op.create_table(
        "workflows",
        sa.Column("id", UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("status", sa.String(20), nullable=True, server_default="draft"),
        sa.Column("trigger_type", sa.String(20), nullable=True),
        sa.Column("trigger_config", JSONB, nullable=True),
        sa.Column("run_count", sa.Integer, nullable=True, server_default="0"),
        sa.Column("last_run_status", sa.String(10), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
    )
    op.create_index("ix_workflows_tenant_id_status", "workflows", ["tenant_id", "status"])
    _apply_rls("workflows")

    # workflow_node_instances
    op.create_table(
        "workflow_node_instances",
        sa.Column("id", UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("workflow_id", UUID(as_uuid=True), nullable=False),
        sa.Column("node_definition_id", UUID(as_uuid=True), nullable=True),
        sa.Column("node_type", sa.String(100), nullable=False),
        sa.Column("label", sa.String(255), nullable=True),
        sa.Column("position_x", sa.Numeric(8, 2), nullable=True),
        sa.Column("position_y", sa.Numeric(8, 2), nullable=True),
        sa.Column("config", JSONB, nullable=True),
        sa.Column("credential_id", UUID(as_uuid=True), nullable=True),
        sa.Column("is_disabled", sa.Boolean, nullable=True, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"]),
        sa.ForeignKeyConstraint(["node_definition_id"], ["node_definitions.id"]),
    )
    op.create_index("ix_workflow_node_instances_tenant_id_workflow_id", "workflow_node_instances", ["tenant_id", "workflow_id"])
    _apply_rls("workflow_node_instances")

    # workflow_edges
    op.create_table(
        "workflow_edges",
        sa.Column("id", UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("workflow_id", UUID(as_uuid=True), nullable=False),
        sa.Column("source_node_id", UUID(as_uuid=True), nullable=False),
        sa.Column("source_port", sa.String(100), nullable=False),
        sa.Column("target_node_id", UUID(as_uuid=True), nullable=False),
        sa.Column("target_port", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"]),
        sa.ForeignKeyConstraint(["source_node_id"], ["workflow_node_instances.id"]),
        sa.ForeignKeyConstraint(["target_node_id"], ["workflow_node_instances.id"]),
    )
    op.create_index("ix_workflow_edges_tenant_id_workflow_id", "workflow_edges", ["tenant_id", "workflow_id"])
    _apply_rls("workflow_edges")

    # social_accounts
    op.create_table(
        "social_accounts",
        sa.Column("id", UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("platform", sa.String(20), nullable=False),
        sa.Column("platform_user_id", sa.String(255), nullable=True),
        sa.Column("username", sa.String(255), nullable=True),
        sa.Column("access_token_enc", sa.Text, nullable=True),
        sa.Column("refresh_token_enc", sa.Text, nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=True, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
    )
    op.create_index("ix_social_accounts_tenant_id_platform", "social_accounts", ["tenant_id", "platform"])
    _apply_rls("social_accounts")

    # scheduled_posts
    op.create_table(
        "scheduled_posts",
        sa.Column("id", UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("clip_id", UUID(as_uuid=True), nullable=True),
        sa.Column("social_account_id", UUID(as_uuid=True), nullable=True),
        sa.Column("platform", sa.String(20), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("caption", sa.Text, nullable=True),
        sa.Column("hashtags", ARRAY(sa.Text), nullable=True),
        sa.Column("platform_post_id", sa.String(255), nullable=True),
        sa.Column("retry_count", sa.SmallInteger, nullable=True, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["clip_id"], ["clips.id"]),
    )
    op.create_index("ix_scheduled_posts_scheduled_at", "scheduled_posts", ["scheduled_at"])
    op.create_index("ix_scheduled_posts_tenant_id_scheduled_at", "scheduled_posts", ["tenant_id", "scheduled_at"])
    _apply_rls("scheduled_posts")

    # node_credentials
    op.create_table(
        "node_credentials",
        sa.Column("id", UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("credential_type", sa.String(100), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("data_enc", sa.Text, nullable=False),
        sa.Column("is_valid", sa.Boolean, nullable=True, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
    )
    op.create_index("ix_node_credentials_tenant_id_credential_type", "node_credentials", ["tenant_id", "credential_type"])
    _apply_rls("node_credentials")

    # analytics_events
    op.create_table(
        "analytics_events",
        sa.Column("id", UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("entity_id", UUID(as_uuid=True), nullable=True),
        sa.Column("entity_type", sa.String(50), nullable=True),
        sa.Column("payload", JSONB, nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
    )
    op.create_index("ix_analytics_events_tenant_id_occurred_at", "analytics_events", ["tenant_id", sa.text("occurred_at DESC")])
    op.create_index("ix_analytics_events_tenant_id_event_type", "analytics_events", ["tenant_id", "event_type"])
    _apply_rls("analytics_events")

    # notifications
    op.create_table(
        "notifications",
        sa.Column("id", UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("body", sa.Text, nullable=True),
        sa.Column("type", sa.String(50), nullable=True),
        sa.Column("is_read", sa.Boolean, nullable=True, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
    )
    op.create_index("ix_notifications_tenant_id_is_read_created_at", "notifications", ["tenant_id", "is_read", sa.text("created_at DESC")])
    _apply_rls("notifications")

    # tenant_config
    op.create_table(
        "tenant_config",
        sa.Column("id", UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("brand_color", sa.String(7), nullable=True),
        sa.Column("watermark_url", sa.Text, nullable=True),
        sa.Column("default_caption_style", JSONB, nullable=True),
        sa.Column("auto_hashtags", sa.Boolean, nullable=True, server_default="true"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
    )
    _apply_rls("tenant_config")


def downgrade() -> None:
    # Tenant tables (reverse order)
    op.drop_table("tenant_config")
    op.drop_table("notifications")
    op.drop_table("analytics_events")
    op.drop_table("node_credentials")
    op.drop_table("scheduled_posts")
    op.drop_table("social_accounts")
    op.drop_table("workflow_edges")
    op.drop_table("workflow_node_instances")
    op.drop_table("workflows")
    op.drop_table("brainstorm_sessions")
    op.drop_table("clips")
    op.drop_table("videos")

    # Public tables (reverse order)
    op.drop_table("node_definitions")
    op.drop_table("usage_quotas")
    op.drop_table("subscriptions")
    op.drop_table("users")
    op.drop_table("tenants")
    op.drop_table("plans")

    # Recreate the minimal tenants table from 001_initial so that
    # downgrade leaves the DB in the state 001_initial left it.
    op.create_table(
        "tenants",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("slug", sa.String(63), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("plan", sa.String(50), nullable=False, server_default="free"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
