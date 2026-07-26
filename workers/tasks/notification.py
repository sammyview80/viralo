"""Notification delivery task — DB insert + Redis SSE + email + browser push."""
import asyncio
import json
import logging
import os
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Optional

import redis
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://viralo:viralo@postgres:5432/viralo")
SYNC_DATABASE_URL = DATABASE_URL.replace("+asyncpg", "")
engine = create_engine(SYNC_DATABASE_URL, pool_pre_ping=True)

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
redis_client = redis.from_url(REDIS_URL)

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
EMAIL_FROM = os.getenv("EMAIL_FROM", "noreply@viralo.ai")

VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_CLAIMS_SUB = os.getenv("VAPID_CLAIMS_SUB", "mailto:admin@viralo.ai")


@contextmanager
def _get_session(tenant_id: str):
    with Session(engine) as session:
        session.execute(text("SET LOCAL app.current_tenant = :tid"), {"tid": str(tenant_id)})
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise


async def _send_email(to_address: str, title: str, body: str, action_url: Optional[str]) -> None:
    import aiosmtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    if not SMTP_HOST or not to_address:
        return

    html_body = f"<h2>{title}</h2><p>{body}</p>"
    if action_url:
        html_body += f'<p><a href="{action_url}">View in Viralo</a></p>'

    msg = MIMEMultipart("alternative")
    msg["Subject"] = title
    msg["From"] = EMAIL_FROM
    msg["To"] = to_address
    msg.attach(MIMEText(html_body, "html"))

    await aiosmtplib.send(
        msg,
        hostname=SMTP_HOST,
        port=SMTP_PORT,
        username=SMTP_USER or None,
        password=SMTP_PASS or None,
        start_tls=True,
    )


def _send_web_push(endpoint: str, p256dh: str, auth: str, payload: dict) -> bool:
    """Returns False if subscription is gone (410), True on success, raises on other errors."""
    from pywebpush import webpush, WebPushException

    try:
        webpush(
            subscription_info={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}},
            data=json.dumps(payload),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_CLAIMS_SUB},
        )
        return True
    except WebPushException as ex:
        if ex.response is not None and ex.response.status_code == 410:
            return False
        raise


@celery_app.task(
    name="workers.tasks.notification.send_notification",
    queue="viralo.notifications",
    acks_late=True,
)
def send_notification(
    tenant_id: str,
    user_id: Optional[str],
    type: str,
    title: str,
    body: str,
    action_url: Optional[str] = None,
    metadata: Optional[dict] = None,
):
    notif_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc)

    with _get_session(tenant_id) as session:
        session.execute(
            text("""
                INSERT INTO notifications (id, tenant_id, user_id, type, title, body, action_url, metadata, created_at)
                VALUES (
                    CAST(:id AS uuid),
                    CAST(:tenant_id AS uuid),
                    CAST(:user_id AS uuid),
                    :type,
                    :title,
                    :body,
                    :action_url,
                    CAST(:metadata AS jsonb),
                    :created_at
                )
            """),
            {
                "id": notif_id,
                "tenant_id": tenant_id,
                "user_id": user_id,
                "type": type,
                "title": title,
                "body": body,
                "action_url": action_url,
                "metadata": json.dumps(metadata) if metadata else None,
                "created_at": created_at,
            },
        )

    payload = json.dumps({
        "id": notif_id,
        "user_id": user_id,
        "type": type,
        "title": title,
        "body": body,
        "action_url": action_url,
        "metadata": metadata,
        "created_at": created_at.isoformat(),
    })
    if user_id:
        channel = f"notifications:{tenant_id}:{user_id}"
        try:
            redis_client.publish(channel, payload)
        except Exception:
            logger.exception("send_notification: failed to publish to Redis channel %s", channel)

    with engine.connect() as conn:
        tenant_row = conn.execute(
            text("SELECT notif_email_enabled, notif_push_enabled, notif_types_disabled FROM tenants WHERE id = CAST(:tid AS uuid)"),
            {"tid": tenant_id},
        ).fetchone()

    if not tenant_row:
        return

    email_enabled, push_enabled, types_disabled = tenant_row
    types_disabled = types_disabled or []

    if email_enabled and type not in types_disabled and user_id:
        try:
            with engine.connect() as conn:
                user_row = conn.execute(
                    text("SELECT email FROM users WHERE id = CAST(:uid AS uuid)"),
                    {"uid": user_id},
                ).fetchone()
            if user_row and user_row[0]:
                asyncio.run(_send_email(user_row[0], title, body, action_url))
        except Exception:
            logger.exception("send_notification: email delivery failed for tenant %s", tenant_id)

    if push_enabled and VAPID_PRIVATE_KEY and user_id:
        try:
            with engine.connect() as conn:
                subs = conn.execute(
                    text("""
                        SELECT id, endpoint, p256dh, auth
                        FROM push_subscriptions
                        WHERE tenant_id = CAST(:tid AS uuid)
                          AND user_id = CAST(:uid AS uuid)
                    """),
                    {"tid": tenant_id, "uid": user_id},
                ).fetchall()

            stale_ids = []
            push_payload = {"title": title, "body": body, "action_url": action_url, "type": type}
            for sub_id, endpoint, p256dh, auth in subs:
                try:
                    still_valid = _send_web_push(endpoint, p256dh, auth, push_payload)
                    if not still_valid:
                        stale_ids.append(str(sub_id))
                except Exception:
                    logger.exception("send_notification: push failed for sub %s", sub_id)

            if stale_ids:
                with engine.connect() as conn:
                    conn.execute(
                        text("DELETE FROM push_subscriptions WHERE id = ANY(CAST(:ids AS uuid[]))"),
                        {"ids": stale_ids},
                    )
                    conn.commit()
        except Exception:
            logger.exception("send_notification: push delivery failed for tenant %s", tenant_id)
