import sys
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
for path in (
    ROOT,
    ROOT / "shared",
    ROOT / "services" / "video",
    ROOT / "services" / "platform",
    ROOT / "services" / "core",
):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

import pytest  # noqa: E402
from core.routers.billing import _upsert_subscription  # noqa: E402
from platform_svc.schemas import ScheduledPostCreate  # noqa: E402
from pydantic import ValidationError  # noqa: E402
from sqlalchemy.dialects import postgresql  # noqa: E402
from video.routers.series import SeriesCreate, SeriesUpdate  # noqa: E402


def _series_payload(**overrides):
    payload = {"name": "Daily facts", "niche": "history"}
    payload.update(overrides)
    return payload


def test_series_rejects_invalid_publish_time_and_account_id():
    with pytest.raises(ValidationError):
        SeriesCreate(**_series_payload(publish_time="99:99"))
    with pytest.raises(ValidationError):
        SeriesUpdate(publish_time="24:00")
    with pytest.raises(ValidationError):
        SeriesCreate(**_series_payload(social_account_ids=["x') OR TRUE --"]))


def test_scheduled_post_platform_is_not_client_controlled():
    body = ScheduledPostCreate(
        clip_id=uuid.uuid4(),
        social_account_id=uuid.uuid4(),
        scheduled_at="2026-07-20T12:00:00Z",
        platform="youtube",
    )
    assert "platform" not in body.model_dump()


@pytest.mark.asyncio
async def test_subscription_write_is_an_atomic_tenant_upsert():
    db = AsyncMock()
    await _upsert_subscription(db, uuid.uuid4(), uuid.uuid4(), "monthly")
    statement = db.execute.await_args.args[0]
    sql = str(statement.compile(dialect=postgresql.dialect()))
    assert "ON CONFLICT (tenant_id) DO UPDATE" in sql


def test_paid_duration_lookup_joins_on_tenant_id():
    from workers.tasks.video import _core

    session = MagicMock()
    session.execute.return_value.fetchone.return_value = ("paid@example.com", "pro")
    session_cm = MagicMock()
    session_cm.__enter__.return_value = session
    session_cm.__exit__.return_value = False

    with patch.object(_core, "Session", return_value=session_cm):
        assert _core._is_unlimited(str(uuid.uuid4())) is True

    sql = str(session.execute.call_args.args[0])
    assert "sub.tenant_id = t.id" in sql
    assert "u.tenant_id = t.id" in sql


def test_due_series_rows_are_locked_and_advanced_past_current_publish():
    from workers.tasks import series

    series_id = uuid.uuid4()
    row = SimpleNamespace(
        id=series_id,
        tenant_id=uuid.uuid4(),
        cadence="daily",
        publish_time="23:59",
        next_run_at=datetime.now(UTC),
        dispatch_pending_at=None,
    )
    select_result = MagicMock()
    select_result.fetchall.return_value = [row]
    session = MagicMock()
    session.execute.side_effect = [select_result, MagicMock(), MagicMock()]
    session_cm = MagicMock()
    session_cm.__enter__.return_value = session
    session_cm.__exit__.return_value = False

    delayed_task = MagicMock()
    with patch.object(series, "Session", return_value=session_cm), patch.object(
        series, "generate_series_video", delayed_task
    ):
        result = getattr(series.process_due_series, "run", series.process_due_series)()

    select_sql = str(session.execute.call_args_list[0].args[0])
    update_params = session.execute.call_args_list[1].args[1]
    publish_at = delayed_task.apply_async.call_args.kwargs["args"][1]
    assert "FOR UPDATE SKIP LOCKED" in select_sql
    assert update_params["next"] > update_params["now"]
    assert publish_at
    assert result == {"launched": 1}


def test_publish_worker_atomically_claims_before_external_work():
    from workers.tasks import post

    session = MagicMock()
    session.execute.return_value.fetchone.return_value = None

    @contextmanager
    def fake_session(_tenant_id):
        yield session

    with patch.object(post, "_get_session", fake_session):
        tenant_id, post_id = str(uuid.uuid4()), str(uuid.uuid4())
        if hasattr(post.publish_post, "run"):
            post.publish_post.run(tenant_id, post_id)
        else:
            post.publish_post(MagicMock(), tenant_id, post_id)

    sql = str(session.execute.call_args.args[0])
    assert "SET status = 'publishing'" in sql
    assert "status = 'processing'" in sql
