"""Social account OAuth connect + management endpoints."""
import asyncio
import os
import uuid
from datetime import datetime, timezone, timedelta
from functools import partial
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.deps import get_current_user, get_tenant_db
from shared.schemas.auth import TokenPayload
from platform_svc.crypto import decrypt_token, encrypt_token
from platform_svc.models import SocialAccount
from platform_svc.schemas import OAuthConnectRequest, OAuthConnectResponse, SocialAccountListResponse, SocialAccountResponse

router = APIRouter(tags=["social-accounts"])

# ---------------------------------------------------------------------------
# Platform OAuth helpers
# ---------------------------------------------------------------------------

PLATFORM_TOKEN_URLS = {
    "youtube": "https://oauth2.googleapis.com/token",
    "instagram": "https://api.instagram.com/oauth/access_token",
    "tiktok": "https://open.tiktokapis.com/v2/oauth/token/",
    "twitter": "https://api.twitter.com/2/oauth2/token",
    "linkedin": "https://www.linkedin.com/oauth/v2/accessToken",
    "facebook": "https://graph.facebook.com/oauth/access_token",
}


def _exchange_code(platform: str, code: str, redirect_uri: str, code_verifier: str | None = None) -> dict[str, Any]:
    """
    Exchange an OAuth authorization code for tokens.
    Returns a dict with at minimum: access_token, and optionally refresh_token,
    expires_in, scope, platform_user_id, platform_username.
    """
    platform = platform.lower()

    if platform == "youtube":
        resp = httpx.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": os.environ["YOUTUBE_CLIENT_ID"],
                "client_secret": os.environ["YOUTUBE_CLIENT_SECRET"],
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            timeout=15,
        )
        resp.raise_for_status()
        token_data = resp.json()

        # Fetch user info
        user_resp = httpx.get(
            "https://www.googleapis.com/youtube/v3/channels",
            params={"part": "snippet", "mine": "true"},
            headers={"Authorization": f"Bearer {token_data['access_token']}"},
            timeout=10,
        )
        user_resp.raise_for_status()
        items = user_resp.json().get("items", [])
        channel = items[0] if items else {}
        platform_user_id = channel.get("id", "")
        platform_username = channel.get("snippet", {}).get("title")

        return {
            "access_token": token_data["access_token"],
            "refresh_token": token_data.get("refresh_token"),
            "expires_in": token_data.get("expires_in"),
            "scope": token_data.get("scope"),
            "platform_user_id": platform_user_id,
            "platform_username": platform_username,
        }

    elif platform == "instagram":
        # Step 1: exchange code for user token via Facebook Graph API
        resp = httpx.get(
            "https://graph.facebook.com/oauth/access_token",
            params={
                "client_id": os.environ["INSTAGRAM_CLIENT_ID"],
                "client_secret": os.environ["INSTAGRAM_CLIENT_SECRET"],
                "redirect_uri": redirect_uri,
                "code": code,
            },
            timeout=15,
        )
        resp.raise_for_status()
        user_token = resp.json()["access_token"]

        # Step 2: long-lived user token
        ll_resp = httpx.get(
            "https://graph.facebook.com/oauth/access_token",
            params={
                "grant_type": "fb_exchange_token",
                "client_id": os.environ["INSTAGRAM_CLIENT_ID"],
                "client_secret": os.environ["INSTAGRAM_CLIENT_SECRET"],
                "fb_exchange_token": user_token,
            },
            timeout=15,
        )
        ll_resp.raise_for_status()
        long_user_token = ll_resp.json().get("access_token", user_token)

        # Step 3: get Facebook Pages
        me_resp = httpx.get(
            "https://graph.facebook.com/me",
            params={"fields": "id,name", "access_token": long_user_token},
            timeout=10,
        )
        me_resp.raise_for_status()
        fb_user_id = me_resp.json().get("id", "")

        pages_resp = httpx.get(
            f"https://graph.facebook.com/{fb_user_id}/accounts",
            params={"access_token": long_user_token},
            timeout=10,
        )
        pages_resp.raise_for_status()
        pages = pages_resp.json().get("data", [])

        # Step 4: find Instagram Business account linked to each Page
        ig_user_id = None
        ig_username = None
        page_token = long_user_token

        for page in pages:
            pt = page["access_token"]
            pid = page["id"]
            ig_resp = httpx.get(
                f"https://graph.facebook.com/{pid}",
                params={"fields": "instagram_business_account", "access_token": pt},
                timeout=10,
            )
            ig_data = ig_resp.json().get("instagram_business_account")
            if ig_data:
                ig_user_id = ig_data["id"]
                page_token = pt
                # fetch IG username
                un_resp = httpx.get(
                    f"https://graph.facebook.com/{ig_user_id}",
                    params={"fields": "username,name", "access_token": pt},
                    timeout=10,
                )
                un_data = un_resp.json()
                ig_username = un_data.get("username") or un_data.get("name")
                break

        if not ig_user_id:
            raise ValueError("No Instagram Business account linked to your Facebook Pages. Convert your Instagram to a Business/Creator account and link it to a Facebook Page.")

        return {
            "access_token": page_token,
            "refresh_token": long_user_token,
            "expires_in": None,
            "scope": None,
            "platform_user_id": ig_user_id,
            "platform_username": ig_username,
        }

    elif platform == "tiktok":
        if not code_verifier:
            raise ValueError("TikTok OAuth requires a PKCE code verifier. Please start the TikTok connection again from Integrations.")

        resp = httpx.post(
            "https://open.tiktokapis.com/v2/oauth/token/",
            data={
                "client_key": os.environ["TIKTOK_CLIENT_KEY"],
                "client_secret": os.environ["TIKTOK_CLIENT_SECRET"],
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
                "code_verifier": code_verifier,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=15,
        )
        resp.raise_for_status()
        raw_token_data = resp.json()
        token_data = raw_token_data.get("data") or raw_token_data
        access_token = token_data.get("access_token")
        if not access_token:
            error = token_data.get("error") or raw_token_data.get("error") or token_data.get("message") or raw_token_data.get("message")
            description = (
                token_data.get("error_description")
                or raw_token_data.get("error_description")
                or token_data.get("description")
                or raw_token_data.get("description")
            )
            detail = ": ".join(str(part) for part in (error, description) if part) or "TikTok did not return an access token. Please retry the connection."
            raise ValueError(f"TikTok OAuth token exchange failed: {detail}")

        # Fetch user info
        user_resp = httpx.get(
            "https://open.tiktokapis.com/v2/user/info/",
            params={"fields": "open_id,display_name"},
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        user_resp.raise_for_status()
        raw_user_data = user_resp.json()
        user_data = raw_user_data.get("data", {}).get("user", {})

        return {
            "access_token": access_token,
            "refresh_token": token_data.get("refresh_token"),
            "expires_in": token_data.get("expires_in"),
            "scope": token_data.get("scope"),
            "platform_user_id": user_data.get("open_id") or token_data.get("open_id") or "",
            "platform_username": user_data.get("display_name"),
        }

    elif platform == "twitter":
        import base64 as b64

        api_key = os.environ["TWITTER_API_KEY"]
        api_secret = os.environ["TWITTER_API_SECRET"]
        credentials = b64.b64encode(f"{api_key}:{api_secret}".encode()).decode()

        resp = httpx.post(
            "https://api.twitter.com/2/oauth2/token",
            data={
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
                "code_verifier": code_verifier or "",  # frontend must send the per-flow verifier
            },
            headers={
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            timeout=15,
        )
        resp.raise_for_status()
        token_data = resp.json()
        access_token = token_data["access_token"]

        # Fetch user info
        user_resp = httpx.get(
            "https://api.twitter.com/2/users/me",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        user_resp.raise_for_status()
        user = user_resp.json().get("data", {})

        return {
            "access_token": access_token,
            "refresh_token": token_data.get("refresh_token"),
            "expires_in": token_data.get("expires_in"),
            "scope": token_data.get("scope"),
            "platform_user_id": user.get("id", ""),
            "platform_username": user.get("username"),
        }

    elif platform == "linkedin":
        resp = httpx.post(
            "https://www.linkedin.com/oauth/v2/accessToken",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": os.environ["LINKEDIN_CLIENT_ID"],
                "client_secret": os.environ["LINKEDIN_CLIENT_SECRET"],
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=15,
        )
        resp.raise_for_status()
        token_data = resp.json()
        access_token = token_data["access_token"]

        # Fetch user info via OpenID Connect userinfo
        user_resp = httpx.get(
            "https://api.linkedin.com/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        user_resp.raise_for_status()
        user = user_resp.json()

        return {
            "access_token": access_token,
            "refresh_token": token_data.get("refresh_token"),
            "expires_in": token_data.get("expires_in"),
            "scope": token_data.get("scope"),
            "platform_user_id": user.get("sub", ""),
            "platform_username": user.get("name") or user.get("email"),
        }

    elif platform == "facebook":
        # Step 1: exchange code for user access token
        resp = httpx.get(
            "https://graph.facebook.com/oauth/access_token",
            params={
                "client_id": os.environ["FACEBOOK_APP_ID"],
                "client_secret": os.environ["FACEBOOK_APP_SECRET"],
                "redirect_uri": redirect_uri,
                "code": code,
            },
            timeout=15,
        )
        resp.raise_for_status()
        token_data = resp.json()
        user_token = token_data["access_token"]

        # Step 2: exchange for long-lived user token
        ll_resp = httpx.get(
            "https://graph.facebook.com/oauth/access_token",
            params={
                "grant_type": "fb_exchange_token",
                "client_id": os.environ["FACEBOOK_APP_ID"],
                "client_secret": os.environ["FACEBOOK_APP_SECRET"],
                "fb_exchange_token": user_token,
            },
            timeout=15,
        )
        ll_resp.raise_for_status()
        ll_data = ll_resp.json()
        long_user_token = ll_data.get("access_token", user_token)

        # Step 3: fetch user info
        me_resp = httpx.get(
            "https://graph.facebook.com/me",
            params={"fields": "id,name", "access_token": long_user_token},
            timeout=10,
        )
        me_resp.raise_for_status()
        me = me_resp.json()
        user_id = me.get("id", "")
        user_name = me.get("name")

        # Step 4: fetch managed Pages and get never-expiring Page token
        pages_resp = httpx.get(
            f"https://graph.facebook.com/{user_id}/accounts",
            params={"access_token": long_user_token},
            timeout=10,
        )
        pages_resp.raise_for_status()
        pages = pages_resp.json().get("data", [])

        if pages:
            # Use first page — store page token (never expires) + page info
            page = pages[0]
            page_token = page["access_token"]
            page_id = page["id"]
            page_name = page.get("name", user_name)
            return {
                "access_token": page_token,
                "refresh_token": long_user_token,  # keep user token as refresh for re-fetching page token
                "expires_in": None,  # page tokens never expire
                "scope": None,
                "platform_user_id": page_id,
                "platform_username": page_name,
            }
        else:
            # No pages — store user token (can still post to personal profile in some cases)
            return {
                "access_token": long_user_token,
                "refresh_token": None,
                "expires_in": ll_data.get("expires_in"),
                "scope": None,
                "platform_user_id": user_id,
                "platform_username": user_name,
            }

    else:
        raise ValueError(f"Unsupported platform: {platform}")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/oauth/connect", response_model=OAuthConnectResponse, status_code=status.HTTP_201_CREATED)
async def oauth_connect(
    body: OAuthConnectRequest,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Exchange OAuth authorization code for tokens and store the social account."""
    platform = body.platform.lower()
    if platform not in PLATFORM_TOKEN_URLS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported platform '{platform}'. Supported: {', '.join(PLATFORM_TOKEN_URLS)}",
        )

    loop = asyncio.get_event_loop()
    try:
        token_info = await loop.run_in_executor(
            None,
            partial(_exchange_code, platform, body.code, body.redirect_uri, body.code_verifier),
        )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OAuth token exchange failed: {exc.response.text[:300]}",
        )
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OAuth error: {str(exc)[:300]}",
        )

    # Compute token_expires_at
    token_expires_at: datetime | None = None
    expires_in = token_info.get("expires_in")
    if expires_in:
        token_expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))

    platform_user_id = str(token_info.get("platform_user_id") or "")
    platform_username = token_info.get("platform_username")

    # Upsert: update existing account for same tenant+platform+user
    existing = await db.execute(
        select(SocialAccount).where(
            SocialAccount.platform == platform,
            SocialAccount.platform_user_id == platform_user_id,
            SocialAccount.tenant_id == uuid.UUID(token.tenant_id),
        )
    )
    existing_account = existing.scalar_one_or_none()

    if existing_account:
        existing_account.access_token_enc = encrypt_token(token_info["access_token"])
        existing_account.refresh_token_enc = (
            encrypt_token(token_info["refresh_token"]) if token_info.get("refresh_token") else None
        )
        existing_account.token_expires_at = token_expires_at
        existing_account.scope = token_info.get("scope")
        existing_account.platform_username = platform_username
        existing_account.is_active = True
        account = existing_account
    else:
        account = SocialAccount(
            id=uuid.uuid4(),
            tenant_id=uuid.UUID(token.tenant_id),
            platform=platform,
            platform_user_id=platform_user_id,
            platform_username=platform_username,
            access_token_enc=encrypt_token(token_info["access_token"]),
            refresh_token_enc=(
                encrypt_token(token_info["refresh_token"]) if token_info.get("refresh_token") else None
            ),
            token_expires_at=token_expires_at,
            scope=token_info.get("scope"),
            is_active=True,
        )
        db.add(account)

    await db.commit()
    await db.refresh(account)

    return OAuthConnectResponse(
        account_id=account.id,
        platform=account.platform,
        username=account.platform_username,
    )


@router.get("/social-accounts", response_model=SocialAccountListResponse)
async def list_social_accounts(
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=100),
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """List connected social accounts for the current tenant with pagination."""
    query = select(SocialAccount).where(
        SocialAccount.is_active == True,
        SocialAccount.tenant_id == uuid.UUID(token.tenant_id),
    )
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    result = await db.execute(
        query.order_by(SocialAccount.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    )
    accounts = result.scalars().all()
    return SocialAccountListResponse(
        items=[SocialAccountResponse.model_validate(a) for a in accounts],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.delete("/social-accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_social_account(
    account_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Disconnect (soft-delete) a social account."""
    result = await db.execute(
        select(SocialAccount).where(
            SocialAccount.id == account_id,
            SocialAccount.is_active == True,
            SocialAccount.tenant_id == uuid.UUID(token.tenant_id),
        )
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Social account not found.")

    account.is_active = False
    await db.commit()

