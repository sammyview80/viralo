import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from shared.deps import get_current_user, get_tenant_db
from shared.schemas.auth import TokenPayload
from agent.models import AgentMessage, BrainstormSession
from agent.schemas import (
    MessageListResponse,
    MessageResponse,
    SessionCreate,
    SessionListResponse,
    SessionResponse,
    SessionResultsResponse,
    SessionUpdate,
)

router = APIRouter(tags=["sessions"])


def _get_celery():
    from workers.celery_app import celery_app
    return celery_app


@router.post("/sessions", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(
    body: SessionCreate,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    session = BrainstormSession(
        id=uuid.uuid4(),
        topic=body.topic,
        name=body.name or body.topic[:100],
        status="draft",
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.get("/sessions", response_model=SessionListResponse)
async def list_sessions(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status_filter: str | None = Query(None, alias="status"),
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    q = select(BrainstormSession).where(BrainstormSession.status != "deleted")
    if status_filter:
        q = q.where(BrainstormSession.status == status_filter)

    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    items = (await db.execute(q.order_by(BrainstormSession.created_at.desc()).offset((page - 1) * per_page).limit(per_page))).scalars().all()

    return SessionListResponse(items=list(items), total=total, page=page, per_page=per_page)


@router.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    session = await _get_or_404(db, session_id)
    return session


@router.patch("/sessions/{session_id}", response_model=SessionResponse)
async def update_session(
    session_id: uuid.UUID,
    body: SessionUpdate,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    session = await _get_or_404(db, session_id)
    if body.name is not None:
        session.name = body.name
    await db.commit()
    await db.refresh(session)
    return session


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    session = await _get_or_404(db, session_id)
    session.status = "deleted"
    await db.commit()


@router.post("/sessions/{session_id}/run", status_code=status.HTTP_202_ACCEPTED)
async def run_session(
    session_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    session = await _get_or_404(db, session_id)
    if session.status in ("running", "complete", "failed", "deleted"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Session is {session.status}",
        )
    celery_app = _get_celery()
    celery_app.send_task(
        "workers.tasks.agent.run_session",
        args=[str(token.tenant_id), str(session_id)],
        queue="viralo.agent.run",
    )
    return {"status": "queued", "session_id": str(session_id)}


@router.post("/sessions/{session_id}/pause", status_code=status.HTTP_202_ACCEPTED)
async def pause_session(
    session_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    session = await _get_or_404(db, session_id)
    if session.status != "running":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Session is not running",
        )
    session.status = "paused"
    await db.commit()
    return {"status": "pausing", "session_id": str(session_id)}


@router.post("/sessions/{session_id}/fork", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def fork_session(
    session_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    original = await _get_or_404(db, session_id)
    forked = BrainstormSession(
        id=uuid.uuid4(),
        topic=original.topic,
        name=f"{original.name} (fork)",
        status="draft",
        # langgraph_thread_id intentionally None — fresh thread on run
    )
    db.add(forked)
    await db.commit()
    await db.refresh(forked)
    return forked


@router.get("/sessions/{session_id}/messages", response_model=MessageListResponse)
async def get_messages(
    session_id: uuid.UUID,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    await _get_or_404(db, session_id)
    q = select(AgentMessage).where(AgentMessage.session_id == session_id)
    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    items = (await db.execute(q.order_by(AgentMessage.created_at.asc()).offset((page - 1) * per_page).limit(per_page))).scalars().all()
    return MessageListResponse(items=list(items), total=total, page=page, per_page=per_page)


@router.get("/sessions/{session_id}/results", response_model=SessionResultsResponse)
async def get_results(
    session_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    session = await _get_or_404(db, session_id)
    return SessionResultsResponse(
        session_id=session.id,
        status=session.status,
        niche_verdict=session.niche_verdict,
        video_ideas=session.video_ideas,
        generated_video_id=session.generated_video_id,
        generated_workflow_id=session.generated_workflow_id,
    )


async def _get_or_404(db: AsyncSession, session_id: uuid.UUID) -> BrainstormSession:
    result = await db.execute(
        select(BrainstormSession).where(
            BrainstormSession.id == session_id,
            BrainstormSession.status != "deleted",
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session
