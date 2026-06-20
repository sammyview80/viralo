"""
Idempotent dev seed: creates a pro user + tenant + subscription.

Reads from env (with defaults):
  SEED_EMAIL     = dev@viralo.dev
  SEED_PASSWORD  = viralo123
  SEED_NAME      = Dev User
  DATABASE_URL   (required — set in .env)
"""
import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

EMAIL = os.environ.get("SEED_EMAIL", "dev@viralo.dev")
PASSWORD = os.environ.get("SEED_PASSWORD", "viralo123")
NAME = os.environ.get("SEED_NAME", "Dev User")
DATABASE_URL = os.environ["DATABASE_URL"]

# sqlalchemy async needs postgresql+asyncpg scheme
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
elif DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def seed():
    async with AsyncSessionLocal() as db:
        # 1. Resolve pro plan id
        result = await db.execute(text("SELECT id FROM plans WHERE name = 'pro' LIMIT 1"))
        row = result.fetchone()
        if not row:
            # Insert minimal pro plan if missing
            plan_id = uuid.uuid4()
            await db.execute(text("""
                INSERT INTO plans (id, name, price_monthly, price_yearly,
                    videos_per_month, platforms_allowed, brainstorm_sessions,
                    workflows_allowed, voice_clone, custom_llm_key, storage_gb, team_members)
                VALUES (:id, 'pro', 29.00, 290.00, 30, 3, 100, 0, false, false, 20, 1)
                ON CONFLICT DO NOTHING
            """), {"id": str(plan_id)})
            await db.commit()
        else:
            plan_id = row[0]

        # 2. Check user exists
        result = await db.execute(text("SELECT id, tenant_id FROM users WHERE email = :email"), {"email": EMAIL})
        user_row = result.fetchone()

        if user_row:
            user_id, tenant_id = user_row
            print(f"User already exists: {EMAIL} (id={user_id})")
        else:
            # 3. Create tenant (or fetch existing by subdomain)
            subdomain = EMAIL.split("@")[0].replace(".", "-").lower()
            t_result = await db.execute(
                text("SELECT id FROM tenants WHERE subdomain = :s"), {"s": subdomain}
            )
            t_row = t_result.fetchone()
            if t_row:
                tenant_id = t_row[0]
            else:
                tenant_id = uuid.uuid4()
                await db.execute(text("""
                    INSERT INTO tenants (id, subdomain, display_name, plan_id, status)
                    VALUES (:id, :subdomain, :name, :plan_id, 'active')
                """), {"id": str(tenant_id), "subdomain": subdomain, "name": NAME, "plan_id": str(plan_id)})

            # 4. Create user
            user_id = uuid.uuid4()
            hashed = bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt()).decode()
            await db.execute(text("""
                INSERT INTO users (id, tenant_id, email, hashed_password, full_name,
                    is_active, is_verified, onboarding_step)
                VALUES (:id, :tenant_id, :email, :pw, :name, true, true, 99)
                ON CONFLICT (email) DO NOTHING
            """), {
                "id": str(user_id),
                "tenant_id": str(tenant_id),
                "email": EMAIL,
                "pw": hashed,
                "name": NAME,
            })

            await db.commit()
            print(f"Created user: {EMAIL} / {PASSWORD} (id={user_id}, tenant={tenant_id})")

        # 5. Upsert pro subscription
        result = await db.execute(text(
            "SELECT id FROM subscriptions WHERE tenant_id = :tid AND status = 'active' LIMIT 1"
        ), {"tid": str(tenant_id)})
        sub_row = result.fetchone()

        if sub_row:
            print(f"Active subscription already exists for tenant {tenant_id}")
        else:
            now = datetime.now(timezone.utc)
            sub_id = uuid.uuid4()
            await db.execute(text("""
                INSERT INTO subscriptions (id, tenant_id, plan_id, status, billing_cycle,
                    current_period_start, current_period_end, cancel_at_period_end)
                VALUES (:id, :tenant_id, :plan_id, 'active', 'monthly',
                    :start, :end, false)
                ON CONFLICT DO NOTHING
            """), {
                "id": str(sub_id),
                "tenant_id": str(tenant_id),
                "plan_id": str(plan_id),
                "start": now,
                "end": now + timedelta(days=36500),  # ~100 years
            })
            await db.commit()
            print(f"Created pro subscription for tenant {tenant_id}")

        print("Seed complete.")


asyncio.run(seed())
