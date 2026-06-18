import json
import logging
import uuid

import redis.asyncio as aioredis
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from shared.auth import decode_token
from shared.db import AsyncSessionLocal
from agent.models import BrainstormSession

logger = logging.getLogger(__name__)
router = APIRouter(tags=["websocket"])

import os
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")


@router.websocket("/ws/{session_id}")
async def websocket_endpoint(
    session_id: str,
    websocket: WebSocket,
    token: str = Query(...),
):
    # Auth via query param
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            await websocket.close(code=4001)
            return
        session_uuid = uuid.UUID(session_id)
        tenant_uuid = uuid.UUID(str(payload.get("tenant_id")))
    except Exception:
        await websocket.close(code=4001)
        return

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(BrainstormSession.id).where(
                BrainstormSession.id == session_uuid,
                BrainstormSession.tenant_id == tenant_uuid,
                BrainstormSession.status != "deleted",
            )
        )
        if result.scalar_one_or_none() is None:
            await websocket.close(code=4003)
            return

    await websocket.accept()

    redis = aioredis.from_url(REDIS_URL)
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
