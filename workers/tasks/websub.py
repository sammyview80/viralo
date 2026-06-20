"""
WebSub (PubSubHubbub) tasks.

- renew_websub_subscriptions: re-subscribes all active channels every 3 days
- process_websub_notification: triggered by incoming YouTube push, starts video pipeline
"""
import hashlib
import hmac
import json
import logging
import os
import uuid
from datetime import datetime, timezone, timedelta

import requests
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app

log = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://viralo:viralo@postgres:5432/viralo")
SYNC_DATABASE_URL = DATABASE_URL.replace("+asyncpg", "")
engine = create_engine(SYNC_DATABASE_URL, pool_pre_ping=True)

WEBSUB_HUB = "https://pubsubhubbub.appspot.com/subscribe"
WEBSUB_SECRET = os.getenv("WEBSUB_SECRET", "viralo-websub-secret")
LEASE_SECONDS = 432000  # 5 days — renew every 3 days so always fresh


def _topic_url(channel_id: str) -> str:
    return f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"


def _callback_url(channel_id: str) -> str:
    base = os.getenv("PUBLIC_BASE_URL", "https://app.viralo.io")
    return f"{base}/api/v1/websub/callback/{channel_id}"


def _subscribe(channel_id: str, mode: str = "subscribe") -> bool:
    """Send subscribe/unsubscribe request to PubSubHubbub hub."""
    try:
        resp = requests.post(WEBSUB_HUB, data={
            "hub.mode": mode,
            "hub.topic": _topic_url(channel_id),
            "hub.callback": _callback_url(channel_id),
            "hub.lease_seconds": LEASE_SECONDS,
            "hub.secret": WEBSUB_SECRET,
        }, timeout=15)
        # Hub returns 202 Accepted for async verification
        if resp.status_code in (200, 202, 204):
            log.info("WebSub %s sent for channel %s → %d", mode, channel_id, resp.status_code)
            return True
        log.warning("WebSub %s failed for %s → %d %s", mode, channel_id, resp.status_code, resp.text[:200])
        return False
    except Exception as e:
        log.error("WebSub %s error for %s: %s", mode, channel_id, e)
        return False


@celery_app.task(name="workers.tasks.websub.renew_websub_subscriptions")
def renew_websub_subscriptions():
    """Re-subscribe all active channel subscriptions. Runs every 3 days via celery-beat."""
    with Session(engine) as db:
        rows = db.execute(
            text("SELECT channel_id FROM channel_subscriptions WHERE active = true")
        ).fetchall()

    log.info("WebSub renew: %d active subscriptions", len(rows))
    renewed = 0
    for row in rows:
        channel_id = row[0]
        ok = _subscribe(channel_id, mode="subscribe")
        if ok:
            with Session(engine) as db:
                db.execute(
                    text("""
                        UPDATE channel_subscriptions
                        SET subscribed_at = now(),
                            lease_expires_at = now() + interval '5 days',
                            updated_at = now()
                        WHERE channel_id = :cid
                    """),
                    {"cid": channel_id},
                )
                db.commit()
            renewed += 1

    log.info("WebSub renew: %d/%d renewed", renewed, len(rows))
    return {"renewed": renewed, "total": len(rows)}


@celery_app.task(name="workers.tasks.websub.subscribe_channel")
def subscribe_channel(channel_id: str, tenant_id: str, channel_name: str = "", channel_url: str = "",
                      auto_publish: bool = False, auto_publish_config: dict = None):
    """Subscribe to a channel and store in DB. Called when user adds a channel."""
    ok = _subscribe(channel_id)
    now = datetime.now(timezone.utc)
    try:
        tid = uuid.UUID(tenant_id) if tenant_id else uuid.uuid4()
    except ValueError:
        tid = uuid.uuid4()

    with Session(engine) as db:
        existing = db.execute(
            text("SELECT id FROM channel_subscriptions WHERE channel_id = :cid AND tenant_id = :tid"),
            {"cid": channel_id, "tid": tid},
        ).fetchone()

        if existing:
            db.execute(
                text("""
                    UPDATE channel_subscriptions
                    SET active = true, subscribed_at = :now,
                        lease_expires_at = :expires, updated_at = :now,
                        auto_publish = :ap, auto_publish_config = :cfg
                    WHERE channel_id = :cid AND tenant_id = :tid
                """),
                {
                    "cid": channel_id, "tid": tid,
                    "now": now, "expires": now + timedelta(seconds=LEASE_SECONDS),
                    "ap": auto_publish, "cfg": json.dumps(auto_publish_config or {}),
                },
            )
        else:
            db.execute(
                text("""
                    INSERT INTO channel_subscriptions
                        (id, tenant_id, channel_id, channel_name, channel_url,
                         auto_publish, auto_publish_config, active,
                         subscribed_at, lease_expires_at, created_at, updated_at)
                    VALUES
                        (:id, :tid, :cid, :name, :url,
                         :ap, :cfg, true,
                         :now, :expires, :now, :now)
                """),
                {
                    "id": uuid.uuid4(), "tid": tid,
                    "cid": channel_id, "name": channel_name, "url": channel_url,
                    "ap": auto_publish, "cfg": json.dumps(auto_publish_config or {}),
                    "now": now, "expires": now + timedelta(seconds=LEASE_SECONDS),
                },
            )
        db.commit()

    return {"channel_id": channel_id, "subscribed": ok}


@celery_app.task(name="workers.tasks.websub.process_websub_notification")
def process_websub_notification(channel_id: str, video_id: str, video_url: str, raw_payload: str = ""):
    """Triggered by webhook when YouTube pushes a new video notification."""
    log.info("WebSub notification: channel=%s video=%s", channel_id, video_id)

    # Dedup — skip if already processed
    with Session(engine) as db:
        existing = db.execute(
            text("SELECT id, processed FROM websub_deliveries WHERE video_id = :vid"),
            {"vid": video_id},
        ).fetchone()

        if existing and existing[1]:
            log.info("WebSub: video %s already processed, skipping", video_id)
            return {"skipped": True, "reason": "already processed"}

        # Log delivery
        delivery_id = uuid.uuid4()
        db.execute(
            text("""
                INSERT INTO websub_deliveries (id, channel_id, video_id, raw_payload, processed, received_at)
                VALUES (:id, :cid, :vid, :payload, false, now())
                ON CONFLICT (video_id) DO NOTHING
            """),
            {"id": delivery_id, "cid": channel_id, "vid": video_id, "payload": raw_payload},
        )
        db.commit()

        # Fetch all active subscriptions for this channel
        subs = db.execute(
            text("""
                SELECT id, tenant_id, auto_publish, auto_publish_config, channel_name
                FROM channel_subscriptions
                WHERE channel_id = :cid AND active = true
            """),
            {"cid": channel_id},
        ).fetchall()

        # Update last_video_id
        db.execute(
            text("""
                UPDATE channel_subscriptions
                SET last_video_id = :vid, last_notified_at = now(), updated_at = now()
                WHERE channel_id = :cid
            """),
            {"cid": channel_id, "vid": video_id},
        )
        db.commit()

    if not subs:
        log.warning("WebSub: no active subscriptions for channel %s", channel_id)
        return {"skipped": True, "reason": "no active subscriptions"}

    # Trigger video pipeline for each tenant subscribed to this channel
    from workers.tasks.video import process_youtube_video
    from workers.tasks.notification import send_notification
    jobs = []
    for sub in subs:
        sub_id, tenant_id, auto_publish, pub_cfg, channel_name = sub
        job_id = str(uuid.uuid4())
        ap_cfg = pub_cfg or {}
        cfg = {
            "max_clips": int(ap_cfg.get("num_clips", 4)),
            "aspect_ratio": ap_cfg.get("aspect_ratio", "9:16"),
            "platforms": ap_cfg.get("platforms", ["tiktok", "reels", "shorts"]),
            "duration_min": int(ap_cfg.get("min_clip_duration", 30)),
            "duration_max": int(ap_cfg.get("max_clip_duration", 60)),
            "output_quality": "source",
            "burn_captions": bool(ap_cfg.get("burn_captions", False)),
            "auto_publish": auto_publish,
            "auto_publish_config": ap_cfg,
            "source": "websub",
            "channel_id": channel_id,
        }
        # Create video row before dispatch — clips.video_id has FK to videos.id
        with Session(engine) as vdb:
            vdb.execute(text("SET LOCAL app.current_tenant = :tid"), {"tid": str(tenant_id)})
            vdb.execute(
                text("""
                    INSERT INTO videos (id, tenant_id, source_type, source_url, status, created_at, updated_at)
                    VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), 'youtube_url', :url, 'queued', now(), now())
                    ON CONFLICT (id) DO NOTHING
                """),
                {"id": job_id, "tid": str(tenant_id), "url": video_url},
            )
            vdb.commit()

        process_youtube_video.apply_async(
            args=[str(tenant_id), job_id, video_url, cfg],
            queue="viralo.video.generate",
        )
        # Update delivery with job_id
        with Session(engine) as db:
            db.execute(
                text("UPDATE websub_deliveries SET job_id = :jid, processed = true WHERE video_id = :vid"),
                {"jid": uuid.UUID(job_id), "vid": video_id},
            )
            db.commit()
        jobs.append({"tenant_id": str(tenant_id), "job_id": job_id})
        log.info("WebSub: triggered pipeline job=%s tenant=%s video=%s", job_id, tenant_id, video_id)

        try:
            ch_label = channel_name or channel_id
            send_notification.delay(
                str(tenant_id),
                user_id=None,
                type="channel_video",
                title=f"New video from {ch_label}",
                body="A new video is being processed and clips will be ready soon.",
                action_url=f"/projects/{job_id}",
                metadata={"channel_id": channel_id, "video_id": video_id, "job_id": job_id},
            )
        except Exception:
            log.warning("WebSub: failed to send channel_video notification for tenant %s", tenant_id)

    return {"triggered": len(jobs), "jobs": jobs}


def verify_websub_signature(body: bytes, signature_header: str) -> bool:
    """Verify X-Hub-Signature from YouTube push. Returns True if valid."""
    if not signature_header:
        return False
    try:
        method, sig = signature_header.split("=", 1)
        expected = hmac.new(WEBSUB_SECRET.encode(), body, hashlib.sha1).hexdigest()
        return hmac.compare_digest(expected, sig)
    except Exception:
        return False
