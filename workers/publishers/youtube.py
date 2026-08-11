"""YouTube Data API v3 publisher."""
import json
import logging
import os
from typing import Optional
from .base import BasePublisher, PublishResult

log = logging.getLogger(__name__)

YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload"
YOUTUBE_TOKEN_URL = "https://oauth2.googleapis.com/token"
CLIENT_ID = os.getenv("YOUTUBE_CLIENT_ID") or os.getenv("GOOGLE_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("YOUTUBE_CLIENT_SECRET") or os.getenv("GOOGLE_CLIENT_SECRET", "")


def _youtube_error_result(exc: Exception) -> PublishResult:
    try:
        from googleapiclient.errors import HttpError
    except ImportError:
        HttpError = ()  # type: ignore

    if isinstance(exc, HttpError):
        status = exc.resp.status if exc.resp else 0
        reason = ""
        api_message = ""
        try:
            detail = json.loads(exc.content.decode()) if exc.content else {}
            error_obj = detail.get("error") or {}
            errors = error_obj.get("errors") or []
            if errors:
                reason = errors[0].get("reason", "") or ""
                api_message = (errors[0].get("message") or reason or "").strip()
            if not api_message:
                api_message = (error_obj.get("message") or reason or "").strip()
        except Exception:
            pass
        msg = (str(exc) or "").strip() or api_message or f"YouTube API error HTTP {status}"
        low = msg.lower()
        if status == 401 or reason in ("authError", "invalidCredentials"):
            return PublishResult(success=False, error=f"YouTube auth failed — reconnect account: {msg[:400]}")
        if status == 403 and (reason == "quotaExceeded" or "quota" in low):
            return PublishResult(success=False, error="YouTube quota exceeded", retry_after_seconds=3600)
        if status in (429, 500, 502, 503) or reason in ("backendError", "rateLimitExceeded"):
            return PublishResult(
                success=False,
                error=f"YouTube temporary error (HTTP {status}): {msg[:400]}",
                retry_after_seconds=120,
            )
        return PublishResult(success=False, error=msg[:500])

    msg = (str(exc) or "").strip() or f"{type(exc).__name__}: YouTube upload failed"
    if "quotaExceeded" in msg:
        return PublishResult(success=False, error="YouTube quota exceeded", retry_after_seconds=3600)
    return PublishResult(success=False, error=msg[:500])


class YouTubePublisher(BasePublisher):
    def publish(self, video_path: str, caption: str, hashtags: list[str], access_token: str,
                refresh_token: Optional[str] = None, title: str = "", description: str = "",
                tags: Optional[list] = None, category_id: str = "22", privacy: str = "public",
                made_for_kids: bool = False, **kwargs) -> PublishResult:
        try:
            from googleapiclient.discovery import build
            from googleapiclient.http import MediaFileUpload
            from google.oauth2.credentials import Credentials

            creds = Credentials(
                token=access_token,
                refresh_token=refresh_token,
                token_uri=YOUTUBE_TOKEN_URL,
                client_id=CLIENT_ID,
                client_secret=CLIENT_SECRET,
            )
            youtube = build("youtube", "v3", credentials=creds)

            snippet_tags = tags if tags is not None else [h.lstrip("#") for h in hashtags]
            body = {
                "snippet": {
                    "title": title or caption[:100],
                    "description": description or caption,
                    "tags": snippet_tags,
                    "categoryId": category_id,
                },
                "status": {
                    "privacyStatus": privacy,
                    "madeForKids": made_for_kids,
                },
            }
            # Larger chunks = fewer HTTP round-trips for the same total upload;
            # 5MB was overly conservative for clips that are typically <200MB.
            media = MediaFileUpload(video_path, mimetype="video/mp4", resumable=True, chunksize=32 * 1024 * 1024)
            request = youtube.videos().insert(part="snippet,status", body=body, media_body=media)
            response = None
            while response is None:
                _, response = request.next_chunk()
            return PublishResult(success=True, platform_post_id=response["id"])
        except Exception as e:
            return _youtube_error_result(e)

    def refresh_token(self, refresh_token: str) -> dict:
        import requests
        resp = requests.post(YOUTUBE_TOKEN_URL, data={
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }, timeout=15)
        resp.raise_for_status()
        return resp.json()
