"""
Google Sheets sync task.

Appends a ready clip's data to a configured spreadsheet so the n8n
publishing workflow can pick it up.

Required env vars:
  GOOGLE_SHEETS_CREDENTIALS_JSON  — service-account JSON (single-line)
  GOOGLE_SHEETS_SPREADSHEET_ID    — target spreadsheet ID
  GOOGLE_SHEETS_SHEET_NAME        — tab name (default: "Clips")
"""
import json
import logging
import os
from datetime import datetime, timezone

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app

log = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://viralo:viralo@postgres:5432/viralo")
SYNC_DATABASE_URL = DATABASE_URL.replace("+asyncpg", "")
engine = create_engine(SYNC_DATABASE_URL, pool_pre_ping=True)

SPREADSHEET_ID = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", "")
SHEET_NAME = os.getenv("GOOGLE_SHEETS_SHEET_NAME", "Clips")

HEADER = [
    "clip_id", "tenant_id", "video_id", "title", "caption",
    "tags", "platform", "storage_url", "thumbnail_url",
    "score", "duration_sec", "published_at",
    "published_to_n8n",   # col M — n8n writes "published" / "error" here
    "published_at_n8n",   # col N — n8n writes ISO timestamp or error message
]


def _get_sheets_client():
    """Build an authenticated Google Sheets API client."""
    creds_json = os.getenv("GOOGLE_SHEETS_CREDENTIALS_JSON", "")
    if not creds_json:
        raise RuntimeError("GOOGLE_SHEETS_CREDENTIALS_JSON not set")

    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build

    creds = Credentials.from_service_account_info(
        json.loads(creds_json),
        scopes=["https://www.googleapis.com/auth/spreadsheets"],
    )
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def _ensure_header(service, spreadsheet_id: str, sheet_name: str) -> None:
    """Write header row if A1 is empty."""
    result = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=spreadsheet_id, range=f"{sheet_name}!A1:L1")
        .execute()
    )
    if not result.get("values"):
        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f"{sheet_name}!A1",
            valueInputOption="RAW",
            body={"values": [HEADER]},
        ).execute()


@celery_app.task(
    name="workers.tasks.gsheet.push_clip_to_gsheet",
    queue="viralo.post.publish",
    max_retries=3,
    default_retry_delay=60,
)
def push_clip_to_gsheet(clip_id: str, tenant_id: str) -> dict:
    """Append a clip row to Google Sheets after upload completes."""
    if not SPREADSHEET_ID:
        log.warning("GOOGLE_SHEETS_SPREADSHEET_ID not set — skipping gsheet push for clip %s", clip_id)
        return {"skipped": True, "reason": "no spreadsheet configured"}

    # Fetch clip data from DB
    with Session(engine) as db:
        row = db.execute(
            text("""
                SELECT
                    c.id::text, c.tenant_id::text, c.video_id::text,
                    c.title, c.storage_url, c.thumbnail_url,
                    c.platform, c.score,
                    ROUND((c.end_sec - c.start_sec)::numeric, 1) AS duration_sec,
                    c.metadata
                FROM clips c
                WHERE c.id = CAST(:cid AS uuid)
                  AND c.tenant_id = CAST(:tid AS uuid)
            """),
            {"cid": clip_id, "tid": tenant_id},
        ).fetchone()

    if not row:
        log.warning("push_clip_to_gsheet: clip %s not found", clip_id)
        return {"skipped": True, "reason": "clip not found"}

    (
        _clip_id, _tenant_id, _video_id,
        title, storage_url, thumbnail_url,
        platform, score, duration_sec, metadata_raw,
    ) = row

    meta = metadata_raw if isinstance(metadata_raw, dict) else json.loads(metadata_raw or "{}")

    # Build caption: prefer platform-specific description, fall back to viral_reason
    platforms_meta = meta.get("platforms", {})
    platform_data = platforms_meta.get(platform, {})
    caption = platform_data.get("description", "") or meta.get("viral_reason", "") or title or ""

    # Tags: platform-specific hashtags, or trending_hashtags pool
    plat_tags: list = platform_data.get("tags", [])
    if not plat_tags:
        plat_tags = meta.get("trending_hashtags", [])
    tags_str = " ".join(f"#{t.lstrip('#')}" for t in plat_tags[:20])

    now = datetime.now(timezone.utc).isoformat()
    sheet_row = [
        _clip_id,
        _tenant_id,
        _video_id,
        title or "",
        caption,
        tags_str,
        platform or "",
        storage_url or "",
        thumbnail_url or "",
        str(round(score or 0, 2)),
        str(duration_sec or ""),
        now,
        "",   # published_to_n8n — n8n fills this
        "",   # published_at_n8n — n8n fills this
    ]

    try:
        service = _get_sheets_client()
        _ensure_header(service, SPREADSHEET_ID, SHEET_NAME)
        service.spreadsheets().values().append(
            spreadsheetId=SPREADSHEET_ID,
            range=f"{SHEET_NAME}!A1",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": [sheet_row]},
        ).execute()
        log.info("push_clip_to_gsheet: appended clip %s to sheet %s", clip_id, SPREADSHEET_ID)
        return {"ok": True, "clip_id": clip_id, "spreadsheet_id": SPREADSHEET_ID}
    except Exception as exc:
        log.error("push_clip_to_gsheet failed for clip %s: %s", clip_id, exc)
        raise
