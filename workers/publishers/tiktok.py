"""TikTok Content Posting API v2 publisher."""
import os
import math
import logging
import requests
from typing import Optional
from pathlib import Path
from .base import BasePublisher, PublishResult

log = logging.getLogger(__name__)

TIKTOK_API = "https://open.tiktokapis.com/v2"
TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
CLIENT_KEY = os.getenv("TIKTOK_CLIENT_KEY", "")
CLIENT_SECRET = os.getenv("TIKTOK_CLIENT_SECRET", "")
CHUNK_SIZE = 5 * 1024 * 1024  # 5MB chunks


class TikTokPublisher(BasePublisher):
    def publish(self, video_path: str, caption: str, hashtags: list[str], access_token: str,
                refresh_token: Optional[str] = None, privacy: str = "PUBLIC_TO_EVERYONE", **kwargs) -> PublishResult:
        try:
            file_size = Path(video_path).stat().st_size
            chunk_count = math.ceil(file_size / CHUNK_SIZE)

            title = caption[:150] + (" " + " ".join(f"#{h.lstrip('#')}" for h in hashtags[:5]))

            # Step 1: Init upload
            r = requests.post(
                f"{TIKTOK_API}/post/publish/video/init/",
                headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json; charset=UTF-8"},
                json={
                    "post_info": {
                        "title": title[:150],
                        "privacy_level": privacy,
                        "disable_duet": False,
                        "disable_comment": False,
                        "disable_stitch": False,
                    },
                    "source_info": {
                        "source": "FILE_UPLOAD",
                        "video_size": file_size,
                        "chunk_size": CHUNK_SIZE,
                        "total_chunk_count": chunk_count,
                    },
                },
                timeout=30,
            )
            if r.status_code == 429:
                retry = int(r.headers.get("Retry-After", 900))
                return PublishResult(success=False, error="TikTok rate limited", retry_after_seconds=retry)
            r.raise_for_status()
            data = r.json().get("data", {})
            publish_id = data.get("publish_id")
            upload_url = data.get("upload_url")

            # Step 2: Upload chunks
            with open(video_path, "rb") as f:
                for i in range(chunk_count):
                    chunk = f.read(CHUNK_SIZE)
                    start = i * CHUNK_SIZE
                    end = start + len(chunk) - 1
                    ru = requests.put(
                        upload_url,
                        headers={
                            "Content-Range": f"bytes {start}-{end}/{file_size}",
                            "Content-Length": str(len(chunk)),
                            "Content-Type": "video/mp4",
                        },
                        data=chunk,
                        timeout=120,
                    )
                    if not ru.ok:
                        return PublishResult(success=False, error=f"Chunk {i} upload failed: {ru.text[:200]}")

            return PublishResult(success=True, platform_post_id=publish_id)
        except requests.HTTPError as e:
            return PublishResult(success=False, error=f"HTTP {e.response.status_code}: {e.response.text[:300]}")
        except Exception as e:
            return PublishResult(success=False, error=str(e)[:500])

    def refresh_token(self, refresh_token: str) -> dict:
        r = requests.post(TOKEN_URL, data={
            "client_key": CLIENT_KEY,
            "client_secret": CLIENT_SECRET,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }, timeout=15)
        r.raise_for_status()
        return r.json().get("data", r.json())
