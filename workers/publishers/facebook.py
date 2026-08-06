"""Facebook Graph API publisher (Page video)."""
import os
import math
import logging
import requests
from typing import Optional
from pathlib import Path
from .base import BasePublisher, PublishResult

log = logging.getLogger(__name__)

GRAPH_URL = "https://graph.facebook.com/v21.0"
RUPLOAD_URL = "https://rupload.facebook.com/video-upload/v21.0"
TOKEN_URL = "https://graph.facebook.com/oauth/access_token"
CLIENT_ID = os.getenv("FACEBOOK_APP_ID", "")
CLIENT_SECRET = os.getenv("FACEBOOK_APP_SECRET", "")
CHUNK_SIZE = 10 * 1024 * 1024  # 10MB


class FacebookPublisher(BasePublisher):
    def publish(self, video_path: str, caption: str, hashtags: list[str], access_token: str,
                refresh_token: Optional[str] = None, page_id: str = "", **kwargs) -> PublishResult:
        try:
            if not page_id:
                return PublishResult(success=False, error="page_id required")

            file_size = Path(video_path).stat().st_size
            tags_text = " ".join(f"#{h.lstrip('#')}" for h in hashtags[:20])
            description = f"{caption}\n{tags_text}"[:63206]

            # Step 1: Start resumable upload session
            r = requests.post(
                f"{RUPLOAD_URL}/{page_id}/videos",
                headers={"Authorization": f"OAuth {access_token}", "Content-Type": "application/json"},
                json={"upload_phase": "start", "file_size": file_size},
                timeout=30,
            )
            r.raise_for_status()
            session = r.json()
            upload_session_id = session["upload_session_id"]
            start_offset = int(session.get("start_offset", 0))

            # Step 2: Upload chunks
            with open(video_path, "rb") as f:
                while start_offset < file_size:
                    f.seek(start_offset)
                    chunk = f.read(CHUNK_SIZE)
                    end_offset = start_offset + len(chunk)
                    cr = requests.post(
                        f"{RUPLOAD_URL}/{page_id}/videos",
                        headers={"Authorization": f"OAuth {access_token}"},
                        data={
                            "upload_phase": "transfer",
                            "upload_session_id": upload_session_id,
                            "start_offset": start_offset,
                        },
                        files={"video_file_chunk": chunk},
                        timeout=120,
                    )
                    cr.raise_for_status()
                    new_offset = int(cr.json().get("start_offset", end_offset))
                    if new_offset <= start_offset:
                        # Facebook didn't acknowledge forward progress — looping
                        # here would hang the task indefinitely instead of failing.
                        return PublishResult(success=False, error=f"Facebook upload stalled at offset {start_offset}")
                    start_offset = new_offset

            # Step 3: Finish upload
            fr = requests.post(
                f"{RUPLOAD_URL}/{page_id}/videos",
                headers={"Authorization": f"OAuth {access_token}", "Content-Type": "application/json"},
                json={
                    "upload_phase": "finish",
                    "upload_session_id": upload_session_id,
                    "description": description,
                    "published": True,
                },
                timeout=30,
            )
            fr.raise_for_status()
            video_id = fr.json().get("video_id", "")
            return PublishResult(success=True, platform_post_id=str(video_id))
        except requests.HTTPError as e:
            if e.response.status_code == 429:
                return PublishResult(success=False, error="Facebook rate limited", retry_after_seconds=900)
            return PublishResult(success=False, error=f"HTTP {e.response.status_code}: {e.response.text[:300]}")
        except Exception as e:
            return PublishResult(success=False, error=str(e)[:500])

    def refresh_token(self, refresh_token: str) -> dict:
        # Facebook Page tokens are long-lived; use extend endpoint
        r = requests.get(
            f"{GRAPH_URL}/oauth/access_token",
            params={
                "grant_type": "fb_exchange_token",
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "fb_exchange_token": refresh_token,
            },
            timeout=15,
        )
        r.raise_for_status()
        return r.json()
