"""
Outbound customer webhooks — fired on video pipeline success/failure.

Tenant configures a target URL + gets a signing secret via
/settings/webhook (see services/core/core/routers/settings.py). The
signature convention mirrors the codebase's inbound WebSub HMAC check
(workers/tasks/websub.py): header `X-Viralo-Signature: sha256=<hexdigest>`
over the raw JSON body.
"""
import hashlib
import hmac
import json
import logging
import os
import uuid
from datetime import datetime, timezone

import requests
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app

log = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://viralo:viralo@postgres:5432/viralo")
SYNC_DATABASE_URL = DATABASE_URL.replace("+asyncpg", "")
engine = create_engine(SYNC_DATABASE_URL, pool_pre_ping=True)

WEBHOOK_TIMEOUT_SEC = 10
# video.status -> public webhook event name
_EVENT_MAP = {"ready": "video.completed", "failed": "video.failed"}
_EVENT_NAMESPACE = uuid.UUID("6e3f8b1a-6f2a-4c1a-9d2e-2a1f9c7b5a10")


def _sign(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def _event_id(video_id: str, status: str, completed_at: str) -> str:
    """Deterministic per (video, terminal status, completion time) so broker
    redelivery or a lost response produces the same event_id — lets receivers
    dedupe instead of double-applying the side effect."""
    return str(uuid.uuid5(_EVENT_NAMESPACE, f"{video_id}:{status}:{completed_at}"))


def enqueue_video_webhook(tenant_id: str, video_id: str, status: str, error_message: str | None = None) -> None:
    """Best-effort enqueue — never raises, never blocks the pipeline."""
    if status not in _EVENT_MAP:
        return
    try:
        dispatch_video_webhook.delay(tenant_id, video_id, status, error_message)
    except Exception:
        log.warning("enqueue_video_webhook: failed to enqueue for video %s", video_id)


@celery_app.task(
    bind=True,
    name="workers.tasks.webhook.dispatch_video_webhook",
    queue="viralo.webhooks",
    acks_late=True,
    max_retries=5,
    default_retry_delay=30,
    time_limit=30,
    soft_time_limit=20,
)
def dispatch_video_webhook(self, tenant_id: str, video_id: str, status: str, error_message: str | None = None) -> dict:
    with Session(engine) as db:
        tenant_row = db.execute(
            text("SELECT webhook_config FROM tenants WHERE id = CAST(:tid AS uuid)"),
            {"tid": tenant_id},
        ).fetchone()
        cfg = (tenant_row[0] if tenant_row else None) or {}
        if not cfg.get("enabled") or not cfg.get("url"):
            return {"skipped": True, "reason": "webhook not configured"}

        video_row = db.execute(
            text("""
                SELECT title, storage_url, duration_sec, created_at, updated_at
                FROM videos
                WHERE id = CAST(:vid AS uuid) AND tenant_id = CAST(:tid AS uuid)
            """),
            {"vid": video_id, "tid": tenant_id},
        ).fetchone()
        clip_count = db.execute(
            text("SELECT COUNT(*) FROM clips WHERE video_id = CAST(:vid AS uuid) AND tenant_id = CAST(:tid AS uuid)"),
            {"vid": video_id, "tid": tenant_id},
        ).scalar() or 0

    title, storage_url, duration_sec, created_at, updated_at = video_row or (None, None, None, None, None)
    now = datetime.now(timezone.utc).isoformat()
    completed_at = updated_at.isoformat() if updated_at else now

    payload = {
        "event_id": _event_id(video_id, status, completed_at),
        "event": _EVENT_MAP[status],
        "video_id": video_id,
        "tenant_id": tenant_id,
        "status": "success" if status == "ready" else "failed",
        "error_reason": error_message if status == "failed" else None,
        "created_at": created_at.isoformat() if created_at else None,
        "completed_at": completed_at,
        "sent_at": now,
        "metadata": {
            "title": title,
            "storage_url": storage_url,
            "duration_sec": duration_sec,
            "clip_count": clip_count,
        },
    }
    body = json.dumps(payload).encode()
    headers = {"Content-Type": "application/json"}
    secret = cfg.get("secret")
    if secret:
        headers["X-Viralo-Signature"] = _sign(secret, body)

    try:
        resp = requests.post(cfg["url"], data=body, headers=headers, timeout=WEBHOOK_TIMEOUT_SEC, allow_redirects=False)
    except requests.RequestException as exc:
        log.warning("dispatch_video_webhook: network error delivering to video %s: %s", video_id, exc)
        return _retry_or_give_up(self, video_id, exc)

    if 200 <= resp.status_code < 300:
        log.info("dispatch_video_webhook: delivered %s for video %s (%s)", payload["event"], video_id, resp.status_code)
        return {"ok": True, "status_code": resp.status_code}

    if resp.status_code >= 500 or resp.status_code == 429:
        exc = RuntimeError(f"webhook endpoint returned {resp.status_code}")
        log.warning("dispatch_video_webhook: retryable status delivering to video %s: %s", video_id, exc)
        return _retry_or_give_up(self, video_id, exc)

    # 3xx and non-429 4xx are permanent failures — endpoint rejected/misconfigured, retrying won't help
    log.error("dispatch_video_webhook: permanent failure for video %s: endpoint returned %s", video_id, resp.status_code)
    return {"ok": False, "status_code": resp.status_code, "error": f"non-2xx response: {resp.status_code}"}


def _retry_or_give_up(task, video_id: str, exc: Exception) -> dict:
    if task.request.retries >= task.max_retries:
        log.error("dispatch_video_webhook: giving up on video %s after %d retries", video_id, task.request.retries)
        return {"ok": False, "error": str(exc)}
    raise task.retry(exc=exc, countdown=min(30 * (2 ** task.request.retries), 900))
