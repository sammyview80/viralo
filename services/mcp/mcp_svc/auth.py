"""OAuth2 client-credentials style auth for the MCP service.

Validates the caller's Viralo API key and mints a short-lived bearer
token used by mcp_svc/client.py to call downstream services.
"""
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from shared.deps import get_viralo_api_key
from shared.auth import create_access_token

router = APIRouter(tags=["mcp-auth"])


class TokenRequest(BaseModel):
    api_key: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/oauth/token", response_model=TokenResponse)
async def issue_token(payload: TokenRequest) -> TokenResponse:
    expected = get_viralo_api_key()
    if payload.api_key != expected:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")

    token = create_access_token({"sub": "mcp-service", "scope": "mcp"})
    return TokenResponse(access_token=token)