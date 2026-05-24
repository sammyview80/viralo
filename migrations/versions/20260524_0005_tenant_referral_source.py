"""make users.tenant_id nullable + add tenants.referral_source

Revision ID: 006_deferred_tenant_onboarding
Revises: 005_rename_metadata_col
Create Date: 2026-05-24

"""
from alembic import op
import sqlalchemy as sa

revision = "006_deferred_tenant_onboarding"
down_revision = "005_rename_metadata_col"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop FK so tenant_id can be null (provisioned at onboarding finalize)
    op.drop_constraint("users_tenant_id_fkey", "users", type_="foreignkey")
    op.alter_column("users", "tenant_id", nullable=True)

    # Referral source collected at onboarding step 2
    op.add_column("tenants", sa.Column("referral_source", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("tenants", "referral_source")
    op.alter_column("users", "tenant_id", nullable=False)
    op.create_foreign_key(
        "users_tenant_id_fkey", "users", "tenants", ["tenant_id"], ["id"]
    )
