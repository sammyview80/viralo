"""Social post publishing worker."""
import asyncio
import base64
import hashlib
import logging
import os
import tempfile
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://viralo:viralo@postgres:5432/viralo")
SYNC_DATABASE_URL = DATABASE_URL.replace("+asyncpg", "")
engine = create_engine(
    SYNC_DATABASE_URL,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=5,
    pool_recycle=3600,
    pool_timeout=30,
)
import atexit as _atexit
_atexit.register(lambda: engine.dispose())


# ── Helpers ───────────────────────────────────────────────────────────────────

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


def _decrypt_token(enc: str) -> str:
    from cryptography.fernet import Fernet
    key = os.getenv("ENCRYPTION_KEY", "")
    if not key:
        secret = os.getenv("SECRET_KEY", "change-me-in-production")
        raw = hashlib.sha256(secret.encode()).digest()
        key = base64.urlsafe_b64encode(raw).decode()
    return Fernet(key.encode()).decrypt(enc.encode()).decode()


def _encrypt_token(plain: str) -> str:
    from cryptography.fernet import Fernet
    key = os.getenv("ENCRYPTION_KEY", "")
    if not key:
        secret = os.getenv("SECRET_KEY", "change-me-in-production")
        raw = hashlib.sha256(secret.encode()).digest()
        key = base64.urlsafe_b64encode(raw).decode()
    return Fernet(key.encode()).encrypt(plain.encode()).decode()


def _platform_live_url(platform: str, platform_post_id: str | None) -> str | None:
    """Return the public URL for a live post, or None if unknown."""
    if not platform_post_id:
        return None
    p = platform.lower()
    if p in ("youtube", "shorts"):
        return f"https://www.youtube.com/shorts/{platform_post_id}"
    if p == "tiktok":
        return f"https://www.tiktok.com/@/video/{platform_post_id}"
    if p in ("instagram", "reels"):
        return f"https://www.instagram.com/reel/{platform_post_id}/"
    if p in ("twitter", "x"):
        return f"https://twitter.com/i/web/status/{platform_post_id}"
    if p == "facebook":
        return f"https://www.facebook.com/{platform_post_id}"
    return None


def _try_insert_notification(
    tenant_id: str,
    title: str,
    body: str,
    post_id: str,
    notification_type: str = "post",
    action_url: str | None = None,
    live_url: str | None = None,
    user_id: str | None = None,
) -> None:
    """Best-effort notification via full pipeline (DB + Redis SSE + email + push)."""
    try:
        from workers.tasks.notification import send_notification
        metadata: dict = {"post_id": post_id}
        if live_url:
            metadata["live_url"] = live_url
        send_notification.delay(
            tenant_id,
            user_id=user_id,
            type=notification_type,
            title=title,
            body=body,
            action_url=action_url or f"/workspace/scheduler?post={post_id}",
            metadata=metadata,
        )
    except Exception:
        logger.exception("failed to enqueue notification for post %s", post_id)


# ── Beat task: scan for due posts ─────────────────────────────────────────────

@celery_app.task(name="workers.tasks.post.process_due_posts")
def process_due_posts():
    """Celery Beat task — find pending posts due for publishing and enqueue them."""
    # Recover posts stuck in 'processing' for >10 min (worker crash / container restart)
    with engine.connect() as conn:
        conn.execute(
            text("""
                UPDATE scheduled_posts
                SET status = 'scheduled', scheduled_at = NOW(), updated_at = NOW()
                WHERE status = 'processing'
                  AND updated_at < NOW() - interval '10 minutes'
            """)
        )
        recovered = conn.execute(
            text("""
                UPDATE scheduled_posts
                SET status = 'failed',
                    last_error = 'Publish outcome unknown after worker interruption; reconcile before retry',
                    updated_at = NOW()
                WHERE status = 'publishing'
                  AND updated_at < NOW() - interval '10 minutes'
            """)
        ).rowcount
        conn.commit()
    if recovered:
        logger.info("process_due_posts: recovered %d stale processing posts", recovered)

    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                UPDATE scheduled_posts
                SET status = 'processing', updated_at = NOW()
                WHERE id IN (
                    SELECT id FROM scheduled_posts
                    WHERE status IN ('pending', 'scheduled')
                      AND scheduled_at <= NOW()
                    ORDER BY scheduled_at ASC
                    LIMIT 500
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING id, tenant_id
            """)
        ).fetchall()
        conn.commit()

    if not rows:
        return

    post_ids = []
    for row in rows:
        post_id = str(row[0])
        tenant_id = str(row[1])
        publish_post.apply_async(
            args=[tenant_id, post_id],
            queue="viralo.post.publish",
        )
        post_ids.append(post_id)

    logger.info("process_due_posts: enqueued %d posts", len(post_ids))


# ── Publish task ──────────────────────────────────────────────────────────────

@celery_app.task(
    bind=True,
    name="workers.tasks.post.publish_post",
    queue="viralo.post.publish",
    acks_late=True,
    max_retries=3,
    time_limit=300,
    soft_time_limit=270,
)
def publish_post(self, tenant_id: str, post_id: str):
    """Publish a scheduled post to the target social platform."""
    tmp_path = None
    clip_id = None   # guard: except block references this before tuple unpack
    platform = "social"
    publish_attempted = False
    notification_user_id = None
    try:
        # ── 1. Load post + social account ─────────────────────────────────────
        with _get_session(tenant_id) as session:
            row = session.execute(
                text("""
                    WITH claimed AS (
                        UPDATE scheduled_posts
                        SET status = 'publishing', updated_at = NOW()
                        WHERE id = CAST(:pid AS uuid) AND status = 'processing'
                        RETURNING *
                    )
                    SELECT
                        sp.id,
                        sp.platform,
                        sp.caption,
                        sp.hashtags,
                        sp.platform_kwargs,
                        sp.retry_count,
                        sp.clip_id,
                        sa.access_token_enc,
                        sa.refresh_token_enc,
                        sa.token_expires_at,
                        sa.platform_user_id,
                        sa.scope,
                        COALESCE(sp.clip_storage_url, c.storage_url) AS clip_storage_url
                    FROM claimed sp
                    JOIN social_accounts sa
                        ON sa.id = sp.social_account_id
                    LEFT JOIN clips c
                        ON c.id = sp.clip_id
                    WHERE sp.id = CAST(:pid AS uuid)
                """),
                {"pid": post_id},
            ).fetchone()

        if not row:
            logger.info("publish_post: post %s was already claimed or is no longer publishable", post_id)
            return

        (
            _post_id,
            platform,
            caption,
            hashtags,
            platform_kwargs_raw,
            retry_count,
            clip_id,
            access_token_enc,
            refresh_token_enc,
            token_expires_at,
            platform_user_id,
            scope,
            clip_storage_url,
        ) = row

        platform_kwargs = platform_kwargs_raw or {}
        notification_user_id = platform_kwargs.pop("notification_user_id", None)
        hashtags = hashtags or []
        retry_count = retry_count or 0

        # ── 2. Decrypt tokens ──────────────────────────────────────────────────
        access_token = _decrypt_token(access_token_enc) if access_token_enc else ""
        refresh_token = _decrypt_token(refresh_token_enc) if refresh_token_enc else None

        # ── 3. Check token expiry (refresh if within 5 minutes) ───────────────
        if token_expires_at:
            now_utc = datetime.now(timezone.utc)
            if isinstance(token_expires_at, datetime) and token_expires_at.tzinfo is None:
                token_expires_at = token_expires_at.replace(tzinfo=timezone.utc)
            expires_soon = token_expires_at <= (now_utc + timedelta(minutes=5))
            if expires_soon and refresh_token:
                try:
                    from workers.publishers.registry import get_publisher
                    publisher = get_publisher(platform)
                    new_tokens = publisher.refresh_token(refresh_token)
                    new_access = new_tokens.get("access_token", "")
                    new_refresh = new_tokens.get("refresh_token", refresh_token)
                    new_expires_in = new_tokens.get("expires_in", 3600)
                    new_expires_at = now_utc + timedelta(seconds=new_expires_in)

                    with _get_session(tenant_id) as session:
                        session.execute(
                            text("""
                                UPDATE social_accounts
                                SET access_token_enc = :at,
                                    refresh_token_enc = :rt,
                                    token_expires_at = :exp,
                                    updated_at = NOW()
                                WHERE id = (
                                    SELECT social_account_id FROM scheduled_posts
                                    WHERE id = CAST(:pid AS uuid)
                                )
                            """),
                            {
                                "at": _encrypt_token(new_access),
                                "rt": _encrypt_token(new_refresh),
                                "exp": new_expires_at,
                                "pid": post_id,
                            },
                        )
                    access_token = new_access
                    refresh_token = new_refresh
                    logger.info("publish_post: refreshed token for post %s", post_id)
                except Exception as e:
                    logger.warning("publish_post: token refresh failed for post %s: %s", post_id, e)

        # ── 4. Download clip video to temp file ───────────────────────────────
        if not clip_storage_url:
            # Clip upload still in progress — retry after 60s
            logger.warning("publish_post: clip_storage_url not yet available for post %s, retrying", post_id)
            with _get_session(tenant_id) as session:
                session.execute(
                    text("""
                        UPDATE scheduled_posts
                        SET status = 'pending',
                            scheduled_at = NOW() + interval '60 seconds',
                            updated_at = NOW()
                        WHERE id = CAST(:pid AS uuid)
                    """),
                    {"pid": post_id},
                )
            return

        from shared.storage.base import get_storage

        storage_provider = os.getenv("STORAGE_PROVIDER", "local")
        storage = get_storage(storage_provider)

        suffix = ".mp4"
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=suffix, prefix=f"viralo_post_{post_id}_")
        os.close(tmp_fd)

        asyncio.run(storage.download(clip_storage_url, tmp_path))

        # ── 5. Publish to platform ────────────────────────────────────────────
        from workers.publishers.registry import get_publisher

        publisher = get_publisher(platform)

        # Build platform-specific kwargs
        pub_kwargs = dict(platform_kwargs)
        plat_lower = platform.lower()
        if plat_lower == "instagram":
            pub_kwargs.setdefault("ig_user_id", platform_user_id)
            pub_kwargs.setdefault("video_url", clip_storage_url)
        elif plat_lower == "facebook":
            pub_kwargs.setdefault("page_id", platform_user_id)
        elif plat_lower == "linkedin":
            pub_kwargs.setdefault("person_urn", platform_user_id)
        elif plat_lower == "twitter":
            # oauth_token_secret stored in scope field
            pub_kwargs.setdefault("oauth_token_secret", scope)

        publish_attempted = True
        result = publisher.publish(
            video_path=tmp_path,
            caption=caption or "",
            hashtags=hashtags,
            access_token=access_token,
            refresh_token=refresh_token,
            **pub_kwargs,
        )

        # ── 6. Handle result ──────────────────────────────────────────────────
        if result.success:
            live_url = _platform_live_url(platform, result.platform_post_id)
            with _get_session(tenant_id) as session:
                session.execute(
                    text("""
                        UPDATE scheduled_posts
                        SET status = 'posted',
                            platform_post_id = :ppid,
                            posted_at = NOW(),
                            updated_at = NOW()
                        WHERE id = CAST(:pid AS uuid)
                    """),
                    {"ppid": result.platform_post_id, "pid": post_id},
                )
            body_text = f"Your {platform} post is live!"
            if live_url:
                body_text += f" {live_url}"
            _try_insert_notification(
                tenant_id,
                title="Post is live!",
                body=body_text,
                post_id=post_id,
                notification_type="post_published",
                action_url=live_url or f"/workspace/scheduler?post={post_id}",
                live_url=live_url,
                user_id=notification_user_id,
            )


        elif result.retry_after_seconds is not None:
            # 429 rate-limited: reschedule the post itself
            retry_after = result.retry_after_seconds or 60
            with _get_session(tenant_id) as session:
                session.execute(
                    text("""
                        UPDATE scheduled_posts
                        SET status = 'pending',
                            scheduled_at = NOW() + (:secs || ' seconds')::interval,
                            retry_count = COALESCE(retry_count, 0) + 1,
                            updated_at = NOW()
                        WHERE id = CAST(:pid AS uuid)
                    """),
                    {"secs": str(retry_after), "pid": post_id},
                )
            logger.warning(
                "publish_post: rate-limited on post %s, rescheduling in %ds",
                post_id, retry_after,
            )

        else:
            # Publisher returned failure
            _handle_publish_failure(
                tenant_id, post_id, platform, retry_count,
                error=result.error or "Publisher returned failure",
                clip_id=str(clip_id) if clip_id else None,
                user_id=notification_user_id,
            )

    except Exception as exc:
        logger.exception("publish_post: exception for post %s", post_id)

        if publish_attempted:
            with _get_session(tenant_id) as session:
                session.execute(
                    text("""
                        UPDATE scheduled_posts
                        SET status = 'failed',
                            last_error = :err,
                            updated_at = NOW()
                        WHERE id = CAST(:pid AS uuid)
                    """),
                    {
                        "err": ("Publish outcome unknown; reconcile before retry: " + str(exc))[:1000],
                        "pid": post_id,
                    },
                )
            return

        # Load current retry_count from DB
        try:
            with _get_session(tenant_id) as session:
                r = session.execute(
                    text("SELECT retry_count FROM scheduled_posts WHERE id = CAST(:pid AS uuid)"),
                    {"pid": post_id},
                ).fetchone()
                current_retries = (r[0] or 0) if r else 0
        except Exception:
            current_retries = self.request.retries

        with _get_session(tenant_id) as session:
            session.execute(
                text("""
                    UPDATE scheduled_posts
                    SET retry_count = COALESCE(retry_count, 0) + 1,
                        last_error = :err,
                        status = 'processing',
                        updated_at = NOW()
                    WHERE id = CAST(:pid AS uuid)
                """),
                {"err": str(exc)[:1000], "pid": post_id},
            )

        if current_retries < 3:
            raise self.retry(exc=exc, countdown=60)
        else:
            # Final failure
            try:
                platform_name = "social"
                with _get_session(tenant_id) as session:
                    r2 = session.execute(
                        text("SELECT platform FROM scheduled_posts WHERE id = CAST(:pid AS uuid)"),
                        {"pid": post_id},
                    ).fetchone()
                    if r2:
                        platform_name = r2[0]
            except Exception:
                pass
            _handle_publish_failure(
                tenant_id, post_id, platform_name, current_retries + 1,
                error=str(exc)[:1000], already_incremented=True,
                clip_id=str(clip_id) if clip_id else None,
                user_id=notification_user_id,
            )

    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


def _handle_publish_failure(
    tenant_id: str,
    post_id: str,
    platform: str,
    retry_count: int,
    error: str,
    already_incremented: bool = False,
    clip_id: str | None = None,
    user_id: str | None = None,
) -> None:
    """Increment retry_count and mark failed if >= 3, insert notification."""
    new_count = retry_count if already_incremented else retry_count + 1
    status = "failed" if new_count >= 3 else "pending"

    with _get_session(tenant_id) as session:
        session.execute(
            text("""
                UPDATE scheduled_posts
                SET retry_count = :rc,
                    last_error = :err,
                    status = :status,
                    updated_at = NOW()
                WHERE id = CAST(:pid AS uuid)
            """),
            {"rc": new_count, "err": error[:1000], "status": status, "pid": post_id},
        )
    if status == "failed":
        failed_url = f"/clips?clip={clip_id}" if clip_id else f"/workspace/scheduler?post={post_id}"
        _try_insert_notification(
            tenant_id,
            title="Post failed",
            body=f"Post failed on {platform}: {error[:200]}",
            post_id=post_id,
            notification_type="post_failed",
            action_url=failed_url,
            user_id=user_id,
        )
