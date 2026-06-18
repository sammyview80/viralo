"""
Ayrshare publisher — free third-party API for unverified apps.

Sign up at https://app.ayrshare.com — free plan supports
TikTok, Instagram, YouTube, Facebook, Twitter/X, LinkedIn, Pinterest.
No platform app-review required; users connect their own accounts to Ayrshare.

Set AYRSHARE_API_KEY in .env.

Docs: https://docs.ayrshare.com/rest-api/endpoints/post
"""
import logging
import os
from typing import Optional

import requests

from .base import BasePublisher, PublishResult

log = logging.getLogger(__name__)

AYRSHARE_API = "https://app.ayrshare.com/api"
AYRSHARE_API_KEY = os.getenv("AYRSHARE_API_KEY", "")

# Map Viralo platform names → Ayrshare platform names
PLATFORM_MAP = {
    "tiktok": "tiktok",
    "instagram": "instagram",
    "reels": "instagram",
    "youtube": "youtube",
    "shorts": "youtube",
    "facebook": "facebook",
    "twitter": "twitter",
    "x": "twitter",
    "linkedin": "linkedin",
    "pinterest": "pinterest",
    "telegram": "telegram",
    "reddit": "reddit",
}


class AyrsharePublisher(BasePublisher):
    """
    Publish via Ayrshare — works for apps that haven't completed
    individual platform verification (TikTok partner review, Instagram
    Business verification, etc.).

    Requires:
      - AYRSHARE_API_KEY env var
      - clip storage_url must be a publicly reachable HTTPS URL
        (Ayrshare fetches the video itself; local/private URLs won't work)
    """

    def publish(
        self,
        video_path: str,          # ignored — Ayrshare pulls from video_url
        caption: str,
        hashtags: list[str],
        access_token: str,        # ignored — auth is via API key
        refresh_token: Optional[str] = None,
        platform: str = "",
        video_url: str = "",      # required: public HTTPS URL of the clip
        scheduled_at: str = "",   # ISO 8601 UTC — omit for immediate post
        profile_key: str = "",    # Ayrshare profile key for sub-accounts (optional)
        **kwargs,
    ) -> PublishResult:
        api_key = AYRSHARE_API_KEY
        if not api_key:
            return PublishResult(success=False, error="AYRSHARE_API_KEY not set")

        if not video_url:
            return PublishResult(success=False, error="video_url (public HTTPS URL) required for Ayrshare")

        ayr_platform = PLATFORM_MAP.get(platform.lower(), platform.lower())
        if not ayr_platform:
            return PublishResult(success=False, error=f"Unknown platform for Ayrshare: {platform}")

        tag_str = " ".join(f"#{h.lstrip('#')}" for h in hashtags if h)
        full_caption = f"{caption}\n\n{tag_str}".strip() if tag_str else caption

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        if profile_key:
            headers["Profile-Key"] = profile_key

        payload: dict = {
            "post": full_caption[:2200],
            "platforms": [ayr_platform],
            "mediaUrls": [video_url],
            "isVideo": True,
        }
        if scheduled_at:
            payload["scheduleDate"] = scheduled_at

        try:
            resp = requests.post(f"{AYRSHARE_API}/post", json=payload, headers=headers, timeout=60)

            if resp.status_code == 429:
                retry = int(resp.headers.get("Retry-After", 900))
                return PublishResult(success=False, error="Ayrshare rate limited", retry_after_seconds=retry)

            data = resp.json()

            if not resp.ok:
                err = data.get("message") or data.get("error") or resp.text[:300]
                log.warning("Ayrshare post failed: %s", err)
                return PublishResult(success=False, error=f"Ayrshare: {err}")

            # Extract platform-specific post ID from response
            platform_results = data.get("postIds", []) or data.get("posts", [])
            post_id = None
            for item in platform_results:
                if isinstance(item, dict) and item.get("platform") == ayr_platform:
                    post_id = item.get("id") or item.get("postId") or item.get("postUrl")
                    break

            if not post_id and platform_results:
                first = platform_results[0]
                post_id = first.get("id") or first.get("postId") if isinstance(first, dict) else str(first)

            log.info("Ayrshare published to %s: post_id=%s", ayr_platform, post_id)
            return PublishResult(success=True, platform_post_id=str(post_id) if post_id else data.get("id"))

        except requests.HTTPError as e:
            return PublishResult(success=False, error=f"HTTP {e.response.status_code}: {e.response.text[:300]}")
        except Exception as e:
            return PublishResult(success=False, error=str(e)[:500])

    def refresh_token(self, refresh_token: str) -> dict:
        # Ayrshare uses a static API key — no token refresh needed
        return {}
