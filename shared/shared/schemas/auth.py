import uuid
from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=1, max_length=255)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    sub: str  # user_id
    tenant_id: str  # empty string until onboarding finalized
    email: str
    plan: str
    type: str


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str | None
    tenant_id: uuid.UUID | None
    is_verified: bool
    onboarding_step: int | None

    model_config = {"from_attributes": True}
