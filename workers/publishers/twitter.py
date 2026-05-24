"""Twitter/X API v2 publisher via tweepy."""
import os
import logging
from typing import Optional
from .base import BasePublisher, PublishResult

log = logging.getLogger(__name__)

API_KEY = os.getenv("TWITTER_API_KEY", "")
API_SECRET = os.getenv("TWITTER_API_SECRET", "")


class TwitterPublisher(BasePublisher):
    def publish(self, video_path: str, caption: str, hashtags: list[str], access_token: str,
                refresh_token: Optional[str] = None, oauth_token_secret: str = "", **kwargs) -> PublishResult:
        try:
            import tweepy

            # OAuth1a user context (needed for media upload)
            auth = tweepy.OAuth1UserHandler(API_KEY, API_SECRET, access_token, oauth_token_secret)
            api_v1 = tweepy.API(auth, wait_on_rate_limit=False)

            # Upload video via v1.1 chunked media upload
            media = api_v1.chunked_upload(
                filename=video_path,
                file_type="video/mp4",
                media_category="tweet_video",
                wait_for_async_finalize=True,
            )
            media_id = str(media.media_id)

            # Post tweet via v2
            client = tweepy.Client(
                consumer_key=API_KEY,
                consumer_secret=API_SECRET,
                access_token=access_token,
                access_token_secret=oauth_token_secret,
            )
            tags = " ".join(f"#{h.lstrip('#')}" for h in hashtags[:5])
            text = f"{caption}\n{tags}"[:280]
            resp = client.create_tweet(text=text, media_ids=[media_id])
            tweet_id = str(resp.data["id"])
            return PublishResult(success=True, platform_post_id=tweet_id)
        except Exception as e:
            msg = str(e)
            if "429" in msg or "Rate limit" in msg.lower():
                return PublishResult(success=False, error="Twitter rate limited", retry_after_seconds=900)
            return PublishResult(success=False, error=msg[:500])

    def refresh_token(self, refresh_token: str) -> dict:
        # OAuth1a tokens don't expire — no-op
        return {}
