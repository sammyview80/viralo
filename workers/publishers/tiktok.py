"""TikTok Content Posting API v2 publisher."""
import os
import logging
import time
import requests
from typing import Optional
from pathlib import Path
from .base import BasePublisher, PublishResult

log = logging.getLogger(__name__)

TIKTOK_API = "https://open.tiktokapis.com/v2"
TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
CLIENT_KEY = os.getenv("TIKTOK_CLIENT_KEY", "")
CLIENT_SECRET = os.getenv("TIKTOK_CLIENT_SECRET", "")
MIN_CHUNK_SIZE = 5 * 1024 * 1024
MAX_CHUNK_SIZE = 64 * 1024 * 1024
STATUS_POLL_ATTEMPTS = 10
STATUS_POLL_DELAY_SECONDS = 3
UPLOAD_MAX_RETRIES = 3


def _calculate_upload_plan(file_size: int) -> tuple[int, int]:
    """Return TikTok-compliant (chunk_size, total_chunk_count).

    TikTok requires non-final chunks to be 5-64 MB. For videos below 64 MB,
    the upload must be a single whole-file chunk with chunk_size == file_size.
    For larger videos, total_chunk_count is floor(video_size / chunk_size),
    and the trailing bytes are merged into the final chunk.
    """
    if file_size <= 0:
        raise ValueError("Video file is empty")
    if file_size <= MAX_CHUNK_SIZE:
        return file_size, 1
    if file_size <= MAX_CHUNK_SIZE * 2:
        chunk_size = file_size // 2
        if chunk_size < MIN_CHUNK_SIZE:
            raise ValueError("Video file is too small for multi-chunk upload")
        return chunk_size, 2

    chunk_size = MAX_CHUNK_SIZE
    return chunk_size, file_size // chunk_size


class TikTokPublisher(BasePublisher):
    def _get_allowed_privacy(self, access_token: str, requested: str) -> tuple[str, Optional[str]]:
        """Query creator_info to find which privacy levels this app/creator can actually use.

        Unaudited/non-approved TikTok apps are restricted by TikTok to a subset of
        privacy_level_options (often just SELF_ONLY) regardless of what we request.
        Posting with a level TikTok doesn't allow returns an error — this was
        previously being swallowed as a hard publish failure, which is one cause
        of the "sometimes posts, sometimes doesn't" behavior. We now ask TikTok
        what's allowed and pick the best match instead of blindly forcing one value.
        """
        try:
            r = requests.post(
                f"{TIKTOK_API}/post/publish/creator_info/query/",
                headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json; charset=UTF-8"},
                timeout=15,
            )
            r.raise_for_status()
            data = r.json().get("data", {})
            options = data.get("privacy_level_options") or []
            if not options:
                return requested, None
            if requested in options:
                return requested, None
            # Requested level not allowed for this creator/app — fall back to the
            # most public option TikTok will actually accept, and surface why.
            for fallback in ("PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"):
                if fallback in options:
                    warning = (
                        f"Requested privacy '{requested}' not permitted by TikTok for this "
                        f"account (allowed: {options}); using '{fallback}' instead."
                    )
                    log.warning(warning)
                    return fallback, warning
            return options[0], f"Requested privacy '{requested}' not allowed; using '{options[0]}'."
        except Exception as e:
            log.warning("TikTok creator_info query failed, proceeding with requested privacy '%s': %s", requested, e)
            return requested, None

    def publish(self, video_path: str, caption: str, hashtags: list[str], access_token: str,
                refresh_token: Optional[str] = None, privacy: str = "PUBLIC_TO_EVERYONE", **kwargs) -> PublishResult:
        try:
            file_size = Path(video_path).stat().st_size
            chunk_size, chunk_count = _calculate_upload_plan(file_size)

            tags = [f"#{h.lstrip('#')}" for h in hashtags[:5] if h]
            tag_str = " ".join(tags)
            while len(tag_str) > 150 and tags:
                tags.pop()
                tag_str = " ".join(tags)
            base_budget = 150 - (len(tag_str) + 1 if tag_str else 0)
            base = caption.strip()[:max(base_budget, 0)] if caption else ""
            title = (f"{base} {tag_str}".strip() or "New video")[:150]

            resolved_privacy, privacy_warning = self._get_allowed_privacy(access_token, privacy)

            # Step 1: Init upload
            r = requests.post(
                f"{TIKTOK_API}/post/publish/video/init/",
                headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json; charset=UTF-8"},
                json={
                    "post_info": {
                        "title": title[:150],
                        "privacy_level": resolved_privacy,
                        "disable_duet": False,
                        "disable_comment": False,
                        "disable_stitch": False,
                    },
                    "source_info": {
                        "source": "FILE_UPLOAD",
                        "video_size": file_size,
                        "chunk_size": chunk_size,
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
            if not publish_id or not upload_url:
                return PublishResult(success=False, error=f"TikTok init missing publish_id/upload_url: {r.text[:300]}")

            # Step 2: Upload chunks
            with open(video_path, "rb") as f:
                for i in range(chunk_count):
                    if i == chunk_count - 1:
                        chunk = f.read()
                    else:
                        chunk = f.read(chunk_size)
                    start = i * chunk_size
                    end = start + len(chunk) - 1
                    last_err = None
                    for attempt in range(UPLOAD_MAX_RETRIES):
                        try:
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
                            if ru.ok:
                                last_err = None
                                break
                            # Retry on transient server-side errors, not on 4xx client errors
                            if ru.status_code < 500:
                                return PublishResult(success=False, error=f"Chunk {i} upload failed: {ru.text[:200]}")
                            last_err = f"HTTP {ru.status_code}: {ru.text[:200]}"
                        except requests.RequestException as e:
                            last_err = str(e)
                        if attempt < UPLOAD_MAX_RETRIES - 1:
                            time.sleep(2 ** attempt)
                    if last_err:
                        return PublishResult(success=False, error=f"Chunk {i} upload failed after retries: {last_err}")

            # Step 3: Poll publish status — TikTok processes the upload asynchronously.
            # Init + upload succeeding does NOT mean the video actually went live; it can
            # still fail moderation/processing afterwards. Previously we returned success
            # right after the upload, which is why posts intermittently never appeared on
            # TikTok despite the task reporting success.
            final_status, status_error = self._poll_publish_status(access_token, publish_id)
            if final_status == "PUBLISH_COMPLETE":
                return PublishResult(success=True, platform_post_id=publish_id)
            if final_status in ("FAILED", "PROCESSING_FAILED"):
                return PublishResult(success=False, error=status_error or f"TikTok publish failed (status={final_status})")
            # Still processing after all poll attempts — treat as success-pending rather
            # than a hard failure (TikTok can legitimately take longer for big files),
            # but surface the uncertainty in the returned error field via log only.
            log.warning(
                "TikTok publish_id %s still in status '%s' after polling; assuming it will complete asynchronously",
                publish_id, final_status,
            )
            return PublishResult(success=True, platform_post_id=publish_id)
        except requests.HTTPError as e:
            return PublishResult(success=False, error=f"HTTP {e.response.status_code}: {e.response.text[:300]}")
        except Exception as e:
            return PublishResult(success=False, error=str(e)[:500])

    def _poll_publish_status(self, access_token: str, publish_id: str) -> tuple[str, Optional[str]]:
        """Poll TikTok's status endpoint until the post completes, fails, or we time out."""
        status = "PROCESSING_DOWNLOAD"
        error_msg = None
        for _ in range(STATUS_POLL_ATTEMPTS):
            try:
                r = requests.post(
                    f"{TIKTOK_API}/post/publish/status/fetch/",
                    headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json; charset=UTF-8"},
                    json={"publish_id": publish_id},
                    timeout=15,
                )
                r.raise_for_status()
                data = r.json().get("data", {})
                status = data.get("status", status)
                if status == "FAILED":
                    fail_reason = data.get("fail_reason") or "unknown reason"
                    error_msg = f"TikTok reported FAILED: {fail_reason}"
                    return status, error_msg
                if status == "PUBLISH_COMPLETE":
                    return status, None
            except Exception as e:
                log.warning("TikTok status poll failed for publish_id %s: %s", publish_id, e)
            time.sleep(STATUS_POLL_DELAY_SECONDS)
        return status, error_msg

    def refresh_token(self, refresh_token: str) -> dict:
        r = requests.post(TOKEN_URL, data={
            "client_key": CLIENT_KEY,
            "client_secret": CLIENT_SECRET,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }, timeout=15)
        r.raise_for_status()
        return r.json().get("data", r.json())
