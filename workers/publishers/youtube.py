"""YouTube Data API v3 publisher."""
import os
import logging
from typing import Optional
from .base import BasePublisher, PublishResult

log = logging.getLogger(__name__)

YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload"
YOUTUBE_TOKEN_URL = "https://oauth2.googleapis.com/token"
CLIENT_ID = os.getenv("YOUTUBE_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("YOUTUBE_CLIENT_SECRET", "")


class YouTubePublisher(BasePublisher):
    def publish(self, video_path: str, caption: str, hashtags: list[str], access_token: str,
                refresh_token: Optional[str] = None, title: str = "", description: str = "",
                category_id: str = "22", privacy: str = "public", **kwargs) -> PublishResult:
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

            tags = [h.lstrip("#") for h in hashtags]
            body = {
                "snippet": {
                    "title": title or caption[:100],
                    "description": description or caption,
                    "tags": tags,
                    "categoryId": category_id,
                },
                "status": {"privacyStatus": privacy},
            }
            media = MediaFileUpload(video_path, mimetype="video/*", resumable=True, chunksize=5 * 1024 * 1024)
            request = youtube.videos().insert(part="snippet,status", body=body, media_body=media)
            response = None
            while response is None:
                _, response = request.next_chunk()
            return PublishResult(success=True, platform_post_id=response["id"])
        except Exception as e:
            msg = str(e)
            if "quotaExceeded" in msg:
                return PublishResult(success=False, error="YouTube quota exceeded", retry_after_seconds=3600)
            return PublishResult(success=False, error=msg[:500])

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
