import os
import uuid
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

from pydantic import BaseModel, field_validator


# ---------------------------------------------------------------------------
# Social Accounts
# ---------------------------------------------------------------------------

class SocialAccountResponse(BaseModel):
    id: uuid.UUID
    platform: str
    platform_username: str | None
    is_active: bool
    token_expires_at: datetime | None
    created_at: Any

    model_config = {"from_attributes": True}


class SocialAccountListResponse(BaseModel):
    items: list[SocialAccountResponse]
    total: int
    page: int
    per_page: int


class OAuthConnectRequest(BaseModel):
    platform: str
    code: str
    redirect_uri: str
    code_verifier: str | None = None

    @field_validator("redirect_uri")
    @classmethod
    def redirect_uri_must_be_allowed(cls, value: str) -> str:
        allowed = [u.strip() for u in os.getenv("OAUTH_ALLOWED_REDIRECT_URIS", "").split(",") if u.strip()]
        if not allowed:
            frontend = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
            allowed = [f"{frontend}/oauth/callback"]
        parsed = urlparse(value)
        if parsed.scheme != "https" and parsed.hostname not in {"localhost", "127.0.0.1"}:
            raise ValueError("redirect_uri must use https")
        if value not in allowed:
            raise ValueError("redirect_uri is not allowed")
        return value


class OAuthConnectResponse(BaseModel):
    account_id: uuid.UUID
    platform: str
    username: str | None


# ---------------------------------------------------------------------------
# Scheduled Posts
# ---------------------------------------------------------------------------

class ScheduledPostCreate(BaseModel):
    clip_id: uuid.UUID
    social_account_id: uuid.UUID
    scheduled_at: datetime
    caption: str | None = None
    hashtags: list[str] | None = None
    platform_kwargs: dict | None = None


class ScheduledPostUpdate(BaseModel):
    scheduled_at: datetime | None = None
    caption: str | None = None
    hashtags: list[str] | None = None


class ScheduledPostResponse(BaseModel):
    id: uuid.UUID
    clip_id: uuid.UUID | None
    social_account_id: uuid.UUID
    platform: str
    status: str
    scheduled_at: datetime
    posted_at: datetime | None
    platform_post_id: str | None
    caption: str | None
    hashtags: list | None
    retry_count: int
    last_error: str | None
    post_metadata: dict | None = None
    clip_storage_url: str | None = None
    clip_thumbnail_url: str | None = None
    created_at: Any
    updated_at: Any

    model_config = {"from_attributes": True}


class ScheduledPostListResponse(BaseModel):
    items: list[ScheduledPostResponse]
    total: int
    page: int
    per_page: int


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------

class AnalyticsEventResponse(BaseModel):
    id: uuid.UUID
    scheduled_post_id: uuid.UUID
    platform: str
    platform_post_id: str | None
    views: int | None
    likes: int | None
    comments: int | None
    shares: int | None
    saves: int | None
    reach: int | None
    impressions: int | None
    engagement_rate: float | None
    fetched_at: datetime

    model_config = {"from_attributes": True}


class AnalyticsSnapshotResponse(BaseModel):
    id: uuid.UUID
    scheduled_post_id: uuid.UUID
    platform: str
    snapshot_date: Any
    views: int | None
    likes: int | None
    comments: int | None
    shares: int | None
    engagement_rate: float | None
    virality_score: float | None
    created_at: datetime

    model_config = {"from_attributes": True}


class AnalyticsOverviewResponse(BaseModel):
    total_views: int
    total_likes: int
    total_comments: int
    total_shares: int
    engagement_rate: float
    posts_count: int
    period: str


class PostAnalyticsDetail(BaseModel):
    post_id: uuid.UUID
    platform: str
    status: str
    posted_at: datetime | None
    caption: str | None
    latest_event: AnalyticsEventResponse | None
    snapshots: list[AnalyticsSnapshotResponse]


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------

class NotificationResponse(BaseModel):
    id: uuid.UUID
    type: str | None = None
    title: str
    body: str | None = None
    is_read: bool
    user_id: uuid.UUID | None = None
    action_url: str | None = None
    read_at: datetime | None = None
    metadata: dict | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class NotificationListResponse(BaseModel):
    items: list[NotificationResponse]
    total: int
    page: int
    per_page: int


class PushSubscribeIn(BaseModel):
    endpoint: str
    p256dh: str
    auth: str
    user_agent: str | None = None


class PushSubscriptionResponse(BaseModel):
    id: uuid.UUID
    endpoint: str
    user_agent: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class PushUnsubscribeIn(BaseModel):
    endpoint: str
