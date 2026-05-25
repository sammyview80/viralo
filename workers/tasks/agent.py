import asyncio
import json
import logging
import os
import threading
import uuid
from contextlib import contextmanager

import redis as redis_sync
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://viralo:viralo@postgres:5432/viralo")
SYNC_DATABASE_URL = DATABASE_URL.replace("+asyncpg", "")
SYNC_PG_URL = SYNC_DATABASE_URL.replace("postgresql+asyncpg", "postgresql")

redis_client = redis_sync.from_url(REDIS_URL)
engine = create_engine(SYNC_DATABASE_URL, pool_pre_ping=True)


@contextmanager
def _get_session(tenant_id: str | None = None):
    with Session(engine) as session:
        if tenant_id:
            session.execute(text(f"SET LOCAL app.current_tenant = '{tenant_id}'"))
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise


def _update_session(tenant_id: str, session_id: str, **kwargs) -> None:
    if not kwargs:
        return
    set_parts = ", ".join(f"{k} = :{k}" for k in kwargs)
    with _get_session(tenant_id) as session:
        session.execute(
            text(f"UPDATE brainstorm_sessions SET {set_parts}, updated_at = NOW() WHERE id = CAST(:sid AS uuid)"),
            {**kwargs, "sid": session_id},
        )


def _save_agent_message(tenant_id: str, session_id: str, agent: str, msg_type: str, content: str, metadata: dict | None = None) -> None:
    with _get_session(tenant_id) as session:
        session.execute(
            text("""
                INSERT INTO agent_messages (id, tenant_id, session_id, agent, msg_type, content, metadata, created_at)
                VALUES (gen_random_uuid(), CAST(:tid AS uuid), CAST(:sid AS uuid), :agent, :msg_type, :content, CAST(:msg_metadata AS jsonb), NOW())
            """),
            {
                "tid": tenant_id,
                "sid": session_id,
                "agent": agent,
                "msg_type": msg_type,
                "content": content,
                "msg_metadata": json.dumps(metadata) if metadata else None,
            },
        )


def _get_session_row(session_id: str) -> dict | None:
    with _get_session(None) as session:
        row = session.execute(
            text("SELECT id, tenant_id, topic, status, langgraph_thread_id, llm_provider, llm_api_key_enc, llm_model FROM brainstorm_sessions bs JOIN tenants t ON t.id = bs.tenant_id WHERE bs.id = CAST(:sid AS uuid)"),
            {"sid": session_id},
        ).mappings().first()
        return dict(row) if row else None


def _get_tenant_row(tenant_id: str) -> dict | None:
    with _get_session(None) as session:
        row = session.execute(
            text("SELECT id, llm_provider, llm_api_key_enc, llm_model FROM tenants WHERE id = CAST(:tid AS uuid)"),
            {"tid": tenant_id},
        ).mappings().first()
        return dict(row) if row else None


def _extend_lock(lock_key: str, ttl: int = 1800, stop_event: threading.Event = None):
    # Run lock renewal in background thread to avoid blocking caller
    def _renew():
        if stop_event and stop_event.wait(timeout=300):
            return
        try:
            redis_client.expire(lock_key, ttl)
        except Exception:
            pass
        if not (stop_event and stop_event.is_set()):
            t = threading.Timer(300, _renew)
            t.daemon = True
            t.start()

    t = threading.Thread(target=_renew, daemon=True)
    t.start()


@celery_app.task(
    bind=True,
    name="workers.tasks.agent.run_session",
    queue="viralo.agent.run",
    acks_late=True,
    max_retries=0,
)
def run_session(self, tenant_id: str, session_id: str):
    lock_key = f"session:{session_id}:lock"
    stop_event = threading.Event()

    # Acquire distributed lock — prevent duplicate execution
    acquired = redis_client.set(lock_key, "1", nx=True, ex=1800)
    if not acquired:
        logger.warning("Session %s already running (lock held)", session_id)
        return

    try:
        _extend_lock(lock_key, 1800, stop_event)
        _run_session_sync(tenant_id, session_id)
    finally:
        stop_event.set()
        redis_client.delete(lock_key)


def _run_session_sync(tenant_id: str, session_id: str):
    tenant = _get_tenant_row(tenant_id)
    if not tenant:
        logger.error("Tenant %s not found", tenant_id)
        return

    # Check session still exists and not paused/deleted
    with _get_session(tenant_id) as session:
        row = session.execute(
            text("SELECT status, topic, langgraph_thread_id FROM brainstorm_sessions WHERE id = CAST(:sid AS uuid)"),
            {"sid": session_id},
        ).mappings().first()
        if not row:
            logger.error("Session %s not found", session_id)
            return
        if row["status"] in ("complete", "deleted"):
            return
        topic = row["topic"]
        thread_id = str(row["langgraph_thread_id"]) if row["langgraph_thread_id"] else str(uuid.uuid4())
        if not row["langgraph_thread_id"]:
            session.execute(
                text("UPDATE brainstorm_sessions SET langgraph_thread_id = CAST(:tid AS uuid) WHERE id = CAST(:sid AS uuid)"),
                {"tid": thread_id, "sid": session_id},
            )

    _update_session(tenant_id, session_id, status="running", current_agent="trend_agent")

    try:
        asyncio.run(_run_graph(tenant_id, session_id, topic, thread_id, tenant))
    except PauseSignal:
        _update_session(tenant_id, session_id, status="paused")
        logger.info("Session %s paused", session_id)
    except Exception as exc:
        logger.exception("Session %s failed: %s", session_id, exc)
        _update_session(tenant_id, session_id, status="failed")
        redis_client.publish(
            f"session:{session_id}:live",
            json.dumps({"type": "error", "agent": "system", "content": str(exc)}),
        )


async def _run_graph(tenant_id: str, session_id: str, topic: str, thread_id: str, tenant: dict):
    import redis.asyncio as aioredis
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from agent.graph.graph import get_compiled_graph
    from agent.llm import get_llm

    async_redis = aioredis.from_url(REDIS_URL)

    # Build checkpointer using sync pg url
    pg_url = SYNC_DATABASE_URL.replace("postgresql+asyncpg", "postgresql")
    async with AsyncPostgresSaver.from_conn_string(pg_url) as checkpointer:
        await checkpointer.setup()

        llm = get_llm(
            llm_provider=tenant.get("llm_provider"),
            llm_api_key_enc=tenant.get("llm_api_key_enc"),
            llm_model=tenant.get("llm_model"),
        )

        app = get_compiled_graph(checkpointer=checkpointer)

        # Pause check wrapper — each node checks before running
        initial_state = {
            "session_id": session_id,
            "tenant_id": tenant_id,
            "topic": topic,
            "trend_data": {},
            "competitor_data": {},
            "monetization_data": {},
            "audience_data": {},
            "video_ideas": [],
            "niche_verdict": "",
            "messages": [],
        }

        config = {
            "configurable": {
                "thread_id": thread_id,
                "llm": llm,
                "redis": async_redis,
                "tenant_id": tenant_id,
                "session_id": session_id,
            }
        }

        # Check if checkpoint exists — resume if yes, start fresh if no
        checkpoint_tuple = await checkpointer.aget_tuple(config)
        if checkpoint_tuple and checkpoint_tuple.checkpoint:
            result = await app.ainvoke(None, config=config)
        else:
            result = await app.ainvoke(initial_state, config=config)

    # Persist results
    video_ideas = result.get("video_ideas", [])
    niche_verdict = result.get("niche_verdict", "")

    _update_session(
        tenant_id, session_id,
        status="complete",
        niche_verdict=niche_verdict,
        video_ideas=json.dumps(video_ideas),
        current_agent=None,
    )

    # Persist all messages from state to DB
    for msg in result.get("messages", []):
        if hasattr(msg, "content"):
            _save_agent_message(
                tenant_id, session_id,
                agent=getattr(msg, "name", "system"),
                msg_type="agent_message",
                content=msg.content if isinstance(msg.content, str) else str(msg.content),
            )

    # TODO: trigger video generation — POST http://video-service:8003/internal/agent/generate
    logger.info("TODO: auto-create video for session %s topic=%s", session_id, topic)
    # TODO: trigger workflow creation — POST http://workflow-service:8005/internal/agent/workflow
    logger.info("TODO: auto-create workflow for session %s", session_id)

    await async_redis.close()


class PauseSignal(Exception):
    pass
