import uuid
from pydantic import BaseModel


class TenantResponse(BaseModel):
    id: uuid.UUID
    subdomain: str
    display_name: str
    plan_id: uuid.UUID | None
    status: str
    storage_provider: str
    llm_provider: str
    timezone: str
    niche: str | None
    goal: str | None

    model_config = {"from_attributes": True}


class TenantUpdate(BaseModel):
    display_name: str | None = None
    timezone: str | None = None
    niche: str | None = None
    goal: str | None = None
    llm_provider: str | None = None
    llm_model: str | None = None
