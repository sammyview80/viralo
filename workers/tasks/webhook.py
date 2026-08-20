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

# Tenant-facing event names a tenant can opt into via webhook_config["events"]
# are the source of truth in services/core/core/routers/settings.py — this
# module only needs the video.status -> event-name mapping above.


def _sign(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def _event_id(entity_id: str, status: str, completed_at: str) -> str:
    """Deterministic per (entity, terminal status, completion time) so broker
    redelivery or a lost response produces the same event_id — lets receivers
    dedupe instead of double-applying the side effect."""
    return str(uuid.uuid5(_EVENT_NAMESPACE, f"{entity_id}:{status}:{completed_at}"))


def enqueue_video_webhook(tenant_id: str, video_id: str, status: str, error_message: str | None = None) -> None:
    """Best-effort enqueue — never raises, never blocks the pipeline."""
    if status not in _EVENT_MAP:
        return
    try:
        dispatch_video_webhook.delay(tenant_id, video_id, status, error_message)
    except Exception:
        log.warning("enqueue_video_webhook: failed to enqueue for video %s", video_id)


def enqueue_webhook(tenant_id: str, event: str, payload: dict) -> None:
    """Best-effort enqueue of a generic webhook event — never raises, never blocks the caller."""
    try:
        dispatch_webhook.delay(tenant_id, event, payload)
    except Exception:
        log.warning("enqueue_webhook: failed to enqueue event %s for tenant %s", event, tenant_id)


def _load_webhook_config(db: Session, tenant_id: str) -> dict | None:
    """Return tenant's webhook_config if enabled/configured, else None."""
    tenant_row = db.execute(
        text("SELECT webhook_config FROM tenants WHERE id = CAST(:tid AS uuid)"),
        {"tid": tenant_id},
    ).fetchone()
    cfg = (tenant_row[0] if tenant_row else None) or {}
    if not cfg.get("enabled") or not cfg.get("url"):
        return None
    return cfg


def _event_enabled(cfg: dict, event: str) -> bool:
    """events list missing entirely => backward-compat default of all events enabled."""
    events = cfg.get("events")
    if events is None:
        return True
    return event in events


def _deliver(task, entity_id: str, payload: dict, cfg: dict, log_name: str) -> dict:
    """Shared HMAC-sign + POST + retry/backoff logic used by every webhook task."""
    body = json.dumps(payload).encode()
    headers = {"Content-Type": "application/json"}
    secret = cfg.get("secret")
    if secret:
        headers["X-Viralo-Signature"] = _sign(secret, body)

    try:
        resp = requests.post(cfg["url"], data=body, headers=headers, timeout=WEBHOOK_TIMEOUT_SEC, allow_redirects=False)
    except requests.RequestException as exc:
        log.warning("%s: network error delivering for %s: %s", log_name, entity_id, exc)
        return _retry_or_give_up(task, entity_id, exc, log_name)

    if 200 <= resp.status_code < 300:
        log.info("%s: delivered %s for %s (%s)", log_name, payload["event"], entity_id, resp.status_code)
        return {"ok": True, "status_code": resp.status_code}

    if resp.status_code >= 500 or resp.status_code == 429:
        exc = RuntimeError(f"webhook endpoint returned {resp.status_code}")
        log.warning("%s: retryable status delivering for %s: %s", log_name, entity_id, exc)
        return _retry_or_give_up(task, entity_id, exc, log_name)

    # 3xx and non-429 4xx are permanent failures — endpoint rejected/misconfigured, retrying won't help
    log.error("%s: permanent failure for %s: endpoint returned %s", log_name, entity_id, resp.status_code)
    return {"ok": False, "status_code": resp.status_code, "error": f"non-2xx response: {resp.status_code}"}


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
        cfg = _load_webhook_config(db, tenant_id)
        if cfg is None:
            return {"skipped": True, "reason": "webhook not configured"}
        if not _event_enabled(cfg, _EVENT_MAP[status]):
            return {"skipped": True, "reason": "event not enabled for tenant"}

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
        # No timestamp component — same fix applied to dispatch_webhook's generic
        # event_id: video_id + status alone is deterministic across celery
        # acks_late redelivery. Breaking change: event_id format differs from
        # before (previously salted with completed_at) for video.completed/video.failed.
        "event_id": _event_id(video_id, status, ""),
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
    return _deliver(self, video_id, payload, cfg, "dispatch_video_webhook")


def _retry_or_give_up(task, entity_id: str, exc: Exception, log_name: str = "dispatch_webhook") -> dict:
    if task.request.retries >= task.max_retries:
        log.error("%s: giving up on %s after %d retries", log_name, entity_id, task.request.retries)
        return {"ok": False, "error": str(exc)}
    raise task.retry(exc=exc, countdown=min(30 * (2 ** task.request.retries), 900))


@celery_app.task(
    bind=True,
    name="workers.tasks.webhook.dispatch_webhook",
    queue="viralo.webhooks",
    acks_late=True,
    max_retries=5,
    default_retry_delay=30,
    time_limit=30,
    soft_time_limit=20,
)
def dispatch_webhook(self, tenant_id: str, event: str, payload: dict) -> dict:
    """Generic outbound webhook dispatch for non-video events (post.*, clip.*).

    `payload` must already contain everything the receiver needs — this task
    only adds event_id/event/tenant_id/sent_at envelope fields and delivers.
    """
    with Session(engine) as db:
        cfg = _load_webhook_config(db, tenant_id)
        if cfg is None:
            return {"skipped": True, "reason": "webhook not configured"}
        if not _event_enabled(cfg, event):
            return {"skipped": True, "reason": "event not enabled for tenant"}

    now = datetime.now(timezone.utc).isoformat()
    entity_id = payload.get("entity_id") or tenant_id

    full_payload = {
        **{k: v for k, v in payload.items() if k != "entity_id"},
        # No timestamp component: entity_id + event name alone is deterministic
        # across celery acks_late redelivery (a timestamp read fresh per attempt,
        # or even a DB updated_at column that can mutate later, would mint a new
        # event_id on redelivery and defeat receiver-side dedup). Trade-off: two
        # genuinely distinct terminal transitions for the same entity+event
        # (e.g. re-processed after a manual retry) would collide — acceptable,
        # this is an edge case rather than the redelivery case being protected.
        "event_id": _event_id(entity_id, event, ""),
        "event": event,
        "tenant_id": tenant_id,
        "sent_at": now,
    }
    return _deliver(self, entity_id, full_payload, cfg, "dispatch_webhook")
