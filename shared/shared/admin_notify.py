import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from shared.db import AsyncSessionLocal
from shared.email import send_email
from shared.models.public.admin_notification import AdminNotification
from shared.models.public.user import User

logger = logging.getLogger(__name__)

DISCORD_ALERTS_URL = "https://discord.com/channels/1538989908423868466/1538990360976556062"


async def notify_new_signup(user_id, user_email: str) -> None:
    """Best-effort admin notification for a new user signup: writes an
    AdminNotification row and emails all superadmins concurrently.

    Opens its OWN database session rather than reusing the caller's —
    this is meant to be scheduled via FastAPI BackgroundTasks, which runs
    after the HTTP response is sent, by which point a request-scoped
    session would already be closed. Must never raise: callers run this
    after the registration commit and registration must never fail or
    wait on this, so all errors are caught and logged here, and email
    sends are fired concurrently (not one-by-one) so a slow mail
    provider with several superadmins doesn't add up sequentially.
    """
    signup_time = datetime.now(timezone.utc)

    async with AsyncSessionLocal() as db:
        try:
            notification = AdminNotification(
                type="new_signup",
                title="New user signup",
                body=f"{user_email} signed up at {signup_time.isoformat()}",
                related_user_id=user_id,
            )
            db.add(notification)
            await db.commit()
        except Exception:
            logger.exception("Failed to write admin notification for new signup user_id=%s", user_id)

        try:
            result = await db.execute(
                select(User.email).where(User.is_superadmin.is_(True), User.is_active.is_(True))
            )
            superadmin_emails = [row[0] for row in result.all()]
        except Exception:
            logger.exception("Failed to look up superadmins for new-signup email alert user_id=%s", user_id)
            return

    if not superadmin_emails:
        logger.warning("No active superadmins found — skipping new-signup email alert for user_id=%s", user_id)
        return

    html_body = (
        f"<p>A new user just signed up.</p>"
        f"<p><b>Email:</b> {user_email}<br>"
        f"<b>Signed up at:</b> {signup_time.isoformat()}</p>"
        f'<p><a href="{DISCORD_ALERTS_URL}">View in Discord</a></p>'
    )

    async def _send_one(admin_email: str) -> None:
        try:
            await send_email(to=admin_email, subject="New Viralo signup", html_body=html_body)
        except Exception:
            logger.exception("Failed to send new-signup email alert to %s for user_id=%s", admin_email, user_id)

    # Concurrent, not sequential — N superadmins no longer means N times the
    # latency. This whole function additionally runs in a BackgroundTasks
    # callback (see auth.py register()), so none of this delays the HTTP
    # response to the registering user regardless.
    await asyncio.gather(*(_send_one(email) for email in superadmin_emails), return_exceptions=True)
