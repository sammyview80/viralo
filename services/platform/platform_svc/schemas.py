import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel


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
    platform: str
    scheduled_at: datetime
    caption: str | None = None
    hashtags: list[str] | None = None


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
    type: str
    title: str
    body: str
    is_read: bool
    metadata: dict | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class NotificationListResponse(BaseModel):
    items: list[NotificationResponse]
    total: int
    page: int
    per_page: int
