import logging
from email.message import EmailMessage

import aiosmtplib

from shared.config import settings

logger = logging.getLogger(__name__)


async def send_email(to: str, subject: str, html_body: str) -> None:
    """Send an HTML email via SMTP. Falls back to logging the content
    (WARNING level, no credentials) when SMTP_HOST is not configured,
    so local dev keeps working without a mail provider set up."""
    if not settings.smtp_host:
        # Never log html_body/to raw link contents here — it may carry a
        # magic-link token or other one-time secret. Redacted summary only.
        logger.warning(
            "SMTP not configured (SMTP_HOST unset) — email not sent. to=%s subject=%r",
            to, subject,
        )
        return

    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = to
    message["Subject"] = subject
    message.set_content("This email requires an HTML-capable client to view.")
    message.add_alternative(html_body, subtype="html")

    await aiosmtplib.send(
        message,
        hostname=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_user or None,
        password=settings.smtp_password or None,
        start_tls=True,
    )
