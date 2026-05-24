import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel


class SessionCreate(BaseModel):
    topic: str
    name: str | None = None


class SessionUpdate(BaseModel):
    name: str | None = None


class SessionResponse(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str | None
    topic: str
    status: str
    current_agent: str | None
    agents_completed: list[str] | None
    niche_verdict: str | None
    video_ideas: list[Any] | None
    generated_video_id: uuid.UUID | None
    generated_workflow_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class SessionListResponse(BaseModel):
    items: list[SessionResponse]
    total: int
    page: int
    per_page: int


class SessionResultsResponse(BaseModel):
    session_id: uuid.UUID
    status: str
    niche_verdict: str | None
    video_ideas: list[Any] | None
    generated_video_id: uuid.UUID | None
    generated_workflow_id: uuid.UUID | None


class MessageResponse(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    agent: str
    msg_type: str
    content: str
    msg_metadata: dict | None = None
    created_at: datetime | None

    model_config = {"from_attributes": True}


class MessageListResponse(BaseModel):
    items: list[MessageResponse]
    total: int
    page: int
    per_page: int
