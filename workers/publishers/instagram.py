"""Instagram Graph API publisher (Reels/video)."""
import os
import time
import logging
import requests
from typing import Optional
from .base import BasePublisher, PublishResult

log = logging.getLogger(__name__)

GRAPH_URL = "https://graph.instagram.com/v21.0"
TOKEN_URL = "https://api.instagram.com/oauth/access_token"
CLIENT_ID = os.getenv("INSTAGRAM_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("INSTAGRAM_CLIENT_SECRET", "")


class InstagramPublisher(BasePublisher):
    def publish(self, video_path: str, caption: str, hashtags: list[str], access_token: str,
                refresh_token: Optional[str] = None, ig_user_id: str = "", video_url: str = "", **kwargs) -> PublishResult:
        try:
            if not ig_user_id:
                return PublishResult(success=False, error="ig_user_id required in kwargs")
            if not video_url:
                return PublishResult(success=False, error="video_url (public URL) required for Instagram")

            full_caption = caption + "\n" + " ".join(f"#{h.lstrip('#')}" for h in hashtags)

            # Step 1: Create media container
            r = requests.post(
                f"{GRAPH_URL}/{ig_user_id}/media",
                params={
                    "media_type": "REELS",
                    "video_url": video_url,
                    "caption": full_caption[:2200],
                    "access_token": access_token,
                },
                timeout=30,
            )
            if r.status_code == 429:
                retry = int(r.headers.get("Retry-After", 900))
                return PublishResult(success=False, error="Rate limited", retry_after_seconds=retry)
            r.raise_for_status()
            container_id = r.json()["id"]

            # Step 2: Poll until container is ready (FINISHED)
            for _ in range(20):
                time.sleep(5)
                s = requests.get(
                    f"{GRAPH_URL}/{container_id}",
                    params={"fields": "status_code", "access_token": access_token},
                    timeout=15,
                ).json()
                if s.get("status_code") == "FINISHED":
                    break
                if s.get("status_code") == "ERROR":
                    return PublishResult(success=False, error=f"Container error: {s}")
            else:
                return PublishResult(success=False, error="Container processing timed out")

            # Step 3: Publish
            r2 = requests.post(
                f"{GRAPH_URL}/{ig_user_id}/media_publish",
                params={"creation_id": container_id, "access_token": access_token},
                timeout=30,
            )
            r2.raise_for_status()
            return PublishResult(success=True, platform_post_id=r2.json()["id"])
        except requests.HTTPError as e:
            return PublishResult(success=False, error=f"HTTP {e.response.status_code}: {e.response.text[:300]}")
        except Exception as e:
            return PublishResult(success=False, error=str(e)[:500])

    def refresh_token(self, refresh_token: str) -> dict:
        # Instagram long-lived tokens don't use standard refresh — extend instead
        r = requests.get(
            "https://graph.instagram.com/refresh_access_token",
            params={"grant_type": "ig_refresh_token", "access_token": refresh_token},
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        return {"access_token": data["access_token"], "expires_in": data.get("expires_in", 5183944)}
