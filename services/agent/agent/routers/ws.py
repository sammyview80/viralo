import json
import logging
import uuid

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from shared.db import AsyncSessionLocal
from shared.deps import get_current_user
from shared.schemas.auth import TokenPayload
from agent.models import BrainstormSession

logger = logging.getLogger(__name__)
router = APIRouter(tags=["websocket"])

import os
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")


@router.post("/ws/{session_id}/ticket")
async def websocket_ticket(session_id: str, token: TokenPayload = Depends(get_current_user)):
    import secrets

    try:
        session_uuid = uuid.UUID(session_id)
        tenant_uuid = uuid.UUID(token.tenant_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session")
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(BrainstormSession.id).where(
            BrainstormSession.id == session_uuid,
            BrainstormSession.tenant_id == tenant_uuid,
            BrainstormSession.status != "deleted",
        ))
        if result.scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail="Session not found")
    ticket = secrets.token_urlsafe(32)
    redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    try:
        await redis.setex(f"ws_ticket:{ticket}", 60, session_id)
    finally:
        await redis.aclose()
    return {"ticket": ticket}


@router.websocket("/ws/{session_id}")
async def websocket_endpoint(
    session_id: str,
    websocket: WebSocket,
    ticket: str = Query(...),
):
    redis = aioredis.from_url(REDIS_URL)
    try:
        claimed = await redis.getdel(f"ws_ticket:{ticket}")
        if isinstance(claimed, bytes):
            claimed = claimed.decode()
        if claimed != session_id:
            raise ValueError("invalid ticket")
        session_uuid = uuid.UUID(session_id)
    except Exception:
        await websocket.close(code=4001)
        await redis.aclose()
        return

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(BrainstormSession.id).where(
                BrainstormSession.id == session_uuid,
                BrainstormSession.status != "deleted",
            )
        )
        if result.scalar_one_or_none() is None:
            await websocket.close(code=4003)
            return

    await websocket.accept()

    pubsub = redis.pubsub()

    try:
        # Replay last 50 messages from buffer
        history = await redis.lrange(f"session:{session_id}:msgs", -50, -1)
        for raw in history:
            await websocket.send_text(raw.decode() if isinstance(raw, bytes) else raw)

        # Subscribe to live channel
        await pubsub.subscribe(f"session:{session_id}:live")

        async for message in pubsub.listen():
            if message["type"] == "message":
                data = message["data"]
                text = data.decode() if isinstance(data, bytes) else data
                await websocket.send_text(text)

                # Stop forwarding after session_complete
                try:
                    parsed = json.loads(text)
                    if parsed.get("type") == "session_complete":
                        break
                except Exception:
                    pass

    except WebSocketDisconnect:
        logger.debug("WebSocket disconnected for session %s", session_id)
    except Exception as exc:
        logger.error("WebSocket error for session %s: %s", session_id, exc)
    finally:
        await pubsub.unsubscribe(f"session:{session_id}:live")
        await pubsub.close()
        await redis.aclose()
