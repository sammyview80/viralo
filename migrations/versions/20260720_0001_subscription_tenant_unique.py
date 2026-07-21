"""enforce one subscription per tenant

Revision ID: 20260720_0001
Revises: 20260711_0001
Create Date: 2026-07-20
"""

from alembic import op

revision = "20260720_0001"
down_revision = "20260711_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM subscriptions
                GROUP BY tenant_id HAVING count(*) > 1
            ) THEN
                RAISE EXCEPTION
                    'duplicate subscriptions require billing reconciliation before migration';
            END IF;
        END $$
    """)
    op.create_unique_constraint(
        "uq_subscriptions_tenant_id", "subscriptions", ["tenant_id"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_subscriptions_tenant_id", "subscriptions", type_="unique")
