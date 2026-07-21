"""Faceless-video Series CRUD — recurring AI-generated videos auto-posted on a schedule."""
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.deps import get_current_user, get_tenant_db
from shared.schemas.auth import TokenPayload

router = APIRouter(tags=["series"])

GENERATION_LEAD_HOURS = 6
CADENCE_DAYS = {"daily": 1, "3x_week": 2, "weekly": 7}

NICHE_PRESETS = [
    {"id": "crime-heists", "label": "Crime & Heists"},
    {"id": "scary-stories", "label": "Scary Stories"},
    {"id": "history", "label": "History"},
    {"id": "greek-mythology", "label": "Greek Mythology"},
    {"id": "historical-figures", "label": "Historical Figures"},
    {"id": "true-crime", "label": "True Crime"},
    {"id": "stoic-motivation", "label": "Stoic Motivation"},
    {"id": "good-morals", "label": "Good Morals"},
]
VOICES = [
    {"id": "en-US-GuyNeural", "label": "Guy — deep American male"},
    {"id": "en-US-ChristopherNeural", "label": "Christopher — calm narrator"},
    {"id": "en-US-JennyNeural", "label": "Jenny — warm American female"},
    {"id": "en-US-AriaNeural", "label": "Aria — expressive female"},
    {"id": "en-GB-RyanNeural", "label": "Ryan — British male"},
    {"id": "en-AU-NatashaNeural", "label": "Natasha — Australian female"},
]
ART_STYLES = [
    {"id": "comic", "label": "Comic"},
    {"id": "creepy-comic", "label": "Creepy Comic"},
    {"id": "modern-cartoon", "label": "Modern Cartoon"},
    {"id": "disney", "label": "Disney"},
    {"id": "anime", "label": "Anime"},
    {"id": "realistic", "label": "Realistic"},
    {"id": "pixel", "label": "Pixel"},
    {"id": "watercolor", "label": "Watercolor"},
]
MUSIC_TRACKS = [
    {"id": "hype", "label": "Hype — energetic"},
    {"id": "dramatic", "label": "Dramatic — tense build"},
    {"id": "chill", "label": "Chill — laid back"},
]


class SeriesCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    niche: str = Field(max_length=64)
    custom_prompt: str | None = Field(default=None, max_length=5000)
    example_script: str | None = Field(default=None, max_length=2000)
    language: str = Field(default="en", max_length=16)
    voice: str = Field(default="en-US-GuyNeural", max_length=64)
    music_track: str | None = None
    art_style: str = Field(default="comic", max_length=64)
    caption_style: str = Field(default="capcut", max_length=32)
    effects: dict = Field(default_factory=dict)
    duration_sec: int = Field(default=65, ge=30, le=180)
    social_account_ids: list[uuid.UUID] = Field(default_factory=list)
    publish_time: str = Field(default="18:00", pattern=r"^\d{2}:\d{2}$")
    cadence: Literal["daily", "3x_week", "weekly"] = "daily"
    auto_publish: bool = True

    @field_validator("publish_time")
    @classmethod
    def validate_publish_time(cls, value: str) -> str:
        datetime.strptime(value, "%H:%M")
        return value


class SeriesUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None
    social_account_ids: list[uuid.UUID] | None = None
    publish_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    cadence: Literal["daily", "3x_week", "weekly"] | None = None
    auto_publish: bool | None = None
    music_track: str | None = None
    caption_style: str | None = None

    @field_validator("publish_time")
    @classmethod
    def validate_publish_time(cls, value: str | None) -> str | None:
        if value is not None:
            datetime.strptime(value, "%H:%M")
        return value


def _next_run_at(cadence: str, publish_time: str) -> datetime:
    """First generation run: lead-hours before the next publish slot."""
    now = datetime.now(timezone.utc)
    hh, mm = (int(x) for x in publish_time.split(":"))
    candidate = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    step = CADENCE_DAYS.get(cadence, 1)
    while candidate - timedelta(hours=GENERATION_LEAD_HOURS) <= now:
        candidate += timedelta(days=step)
    return candidate - timedelta(hours=GENERATION_LEAD_HOURS)


def _row_to_dict(row) -> dict:
    d = dict(row._mapping)
    for k in ("id", "tenant_id"):
        d[k] = str(d[k])
    for k in ("next_run_at", "last_run_at", "created_at", "updated_at"):
        if d.get(k) is not None:
            d[k] = d[k].isoformat()
    return d


@router.get("/series/options")
async def series_options(token: TokenPayload = Depends(get_current_user)):
    """Option catalogs for the create-series wizard."""
    return {"niches": NICHE_PRESETS, "voices": VOICES, "art_styles": ART_STYLES,
            "music_tracks": MUSIC_TRACKS,
            "cadences": [{"id": "daily", "label": "Every day"},
                         {"id": "3x_week", "label": "3× per week"},
                         {"id": "weekly", "label": "Once a week"}]}


@router.get("/series")
async def list_series(
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    rows = (await db.execute(
        text("SELECT * FROM series WHERE tenant_id = CAST(:tid AS uuid) ORDER BY created_at DESC"),
        {"tid": token.tenant_id},
    )).fetchall()
    return [_row_to_dict(r) for r in rows]


@router.post("/series", status_code=status.HTTP_201_CREATED)
async def create_series(
    body: SeriesCreate,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    sid = uuid.uuid4()
    next_run = _next_run_at(body.cadence, body.publish_time)
    await db.execute(
        text("""INSERT INTO series
                  (id, tenant_id, name, niche, custom_prompt, example_script, language, voice,
                   music_track, art_style, caption_style, effects, duration_sec,
                   social_account_ids, publish_time, cadence, auto_publish,
                   is_active, next_run_at, created_at, updated_at)
                VALUES
                  (:id, CAST(:tid AS uuid), :name, :niche, :cp, :ex, :lang, :voice,
                   :music, :art, :cap, CAST(:fx AS jsonb), :dur,
                   CAST(:accts AS jsonb), :pt, :cad, :ap,
                   true, :next_run, now(), now())"""),
        {"id": sid, "tid": token.tenant_id, "name": body.name, "niche": body.niche,
         "cp": body.custom_prompt, "ex": body.example_script, "lang": body.language,
         "voice": body.voice, "music": body.music_track, "art": body.art_style,
         "cap": body.caption_style, "fx": json.dumps(body.effects), "dur": body.duration_sec,
         "accts": json.dumps([str(account_id) for account_id in body.social_account_ids]),
         "pt": body.publish_time,
         "cad": body.cadence, "ap": body.auto_publish, "next_run": next_run},
    )
    await db.commit()
    row = (await db.execute(text("SELECT * FROM series WHERE id = :id"), {"id": sid})).first()
    return _row_to_dict(row)


@router.patch("/series/{series_id}")
async def update_series(
    series_id: uuid.UUID,
    body: SeriesUpdate,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "No fields to update")
    sets, params = [], {"id": series_id, "tid": token.tenant_id}
    for k, v in updates.items():
        if k == "social_account_ids":
            sets.append("social_account_ids = CAST(:accts AS jsonb)")
            params["accts"] = json.dumps([str(account_id) for account_id in v])
        else:
            sets.append(f"{k} = :{k}")
            params[k] = v
    r = await db.execute(
        text(f"""UPDATE series SET {', '.join(sets)}, updated_at = now()
                 WHERE id = :id AND tenant_id = CAST(:tid AS uuid)"""),
        params,
    )
    if r.rowcount == 0:
        raise HTTPException(404, "Series not found")
    # Recompute next run when schedule inputs change or series is re-activated
    if any(k in updates for k in ("publish_time", "cadence", "is_active")):
        row = (await db.execute(
            text("SELECT cadence, publish_time, is_active FROM series WHERE id = :id"),
            {"id": series_id})).first()
        if row and row.is_active:
            await db.execute(
                text("UPDATE series SET next_run_at = :n WHERE id = :id"),
                {"n": _next_run_at(row.cadence, row.publish_time), "id": series_id})
    await db.commit()
    row = (await db.execute(text("SELECT * FROM series WHERE id = :id"), {"id": series_id})).first()
    return _row_to_dict(row)


@router.delete("/series/{series_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_series(
    series_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    r = await db.execute(
        text("DELETE FROM series WHERE id = :id AND tenant_id = CAST(:tid AS uuid)"),
        {"id": series_id, "tid": token.tenant_id})
    if r.rowcount == 0:
        raise HTTPException(404, "Series not found")
    await db.commit()


@router.post("/series/{series_id}/generate-now", status_code=status.HTTP_202_ACCEPTED)
async def generate_now(
    series_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Kick off one generation immediately (posts scheduled ~lead-hours out)."""
    row = (await db.execute(
        text("SELECT id, cadence, publish_time FROM series WHERE id = :id AND tenant_id = CAST(:tid AS uuid)"),
        {"id": series_id, "tid": token.tenant_id})).first()
    if not row:
        raise HTTPException(404, "Series not found")
    from workers.celery_app import celery_app
    publish_at = datetime.now(timezone.utc) + timedelta(hours=GENERATION_LEAD_HOURS)
    celery_app.send_task(
        "workers.tasks.series.generate_series_video",
        args=[str(series_id), publish_at.isoformat()],
        queue="viralo.video.generate",
    )
    return {"status": "queued", "publish_at": publish_at.isoformat()}


@router.get("/series/{series_id}/videos")
async def series_videos(
    series_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    rows = (await db.execute(
        text("""SELECT v.id, v.title, v.status, v.duration_sec, v.thumbnail_url, v.created_at,
                       v.metadata, c.id AS clip_id, c.storage_url, c.thumbnail_url AS clip_thumb
                FROM videos v
                LEFT JOIN clips c ON c.video_id = v.id
                WHERE v.tenant_id = CAST(:tid AS uuid)
                  AND v.source_type = 'series'
                  AND v.metadata->>'series_id' = :sid
                ORDER BY v.created_at DESC LIMIT 100"""),
        {"tid": token.tenant_id, "sid": str(series_id)})).fetchall()
    from video.schemas import sign_media_url

    out = []
    for r in rows:
        d = dict(r._mapping)
        d["id"] = str(d["id"])
        d["clip_id"] = str(d["clip_id"]) if d["clip_id"] else None
        d["created_at"] = d["created_at"].isoformat() if d["created_at"] else None
        for key in ("thumbnail_url", "storage_url", "clip_thumb"):
            d[key] = sign_media_url(d.get(key))
        out.append(d)
    return out
