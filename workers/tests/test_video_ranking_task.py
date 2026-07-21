import json
import time
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import Mock

import pytest

import shared.storage.base as storage_base
import workers.tasks.video._core as core
import workers.tasks.video.tasks as tasks


def _segments(count: int = 2) -> list[dict]:
    return [
        {
            "source_type": "url",
            "url": f"https://example.com/{index}",
            "start_sec": 0,
            "end_sec": 5,
            "segment_title": f"Segment {index + 1}",
        }
        for index in range(count)
    ]


def _run_ranking(segments: list[dict], task_id: str = "ranking-job"):
    return tasks.generate_video_ranking.apply(
        args=["tenant-id", "video-id", segments, "Top Videos", "viral", "countdown"],
        kwargs={"template_config": None},
        task_id=task_id,
        throw=True,
    )


def test_ranking_task_persists_processing_then_terminal_failure(monkeypatch):
    updates: list[dict] = []
    events: list[dict] = []

    monkeypatch.setattr(tasks, "_update_video", lambda _tenant, _video, **values: updates.append(values))
    monkeypatch.setattr(
        tasks,
        "_publish_progress",
        lambda job_id, step, pct, status, message="": events.append(
            {"job_id": job_id, "step": step, "pct": pct, "status": status, "message": message}
        ),
    )

    def fail_download(_url: str, _path: str) -> None:
        raise RuntimeError("source unavailable")

    monkeypatch.setattr(tasks, "_download_youtube", fail_download)

    with pytest.raises(RuntimeError, match="source unavailable"):
        _run_ranking(_segments())

    assert updates[0] == {
        "status": "processing",
        "celery_task_id": "ranking-job",
        "pipeline_step": "starting",
        "pipeline_pct": 2,
        "error_message": None,
    }
    assert updates[-1]["status"] == "failed"
    assert updates[-1]["pipeline_step"] == "failed"
    assert "source unavailable" in updates[-1]["error_message"]
    assert events[-1]["status"] == "failed"
    assert events[-1]["step"] == "failed"


def test_ranking_render_progress_uses_completion_count(monkeypatch, tmp_path):
    events: list[dict] = []
    timeline: list[tuple[str, object]] = []
    monkeypatch.setattr(
        tasks,
        "_update_video",
        lambda _tenant, _video, **values: timeline.append(("database", values)),
    )
    monkeypatch.setattr(
        tasks,
        "_publish_progress",
        lambda job_id, step, pct, status, message="": (
            events.append(
                {"job_id": job_id, "step": step, "pct": pct, "status": status, "message": message}
            ),
            timeline.append(("event", step)),
        ),
    )
    monkeypatch.setattr(
        tasks,
        "_download_youtube",
        lambda _url, path: Path(path).write_bytes(b"source"),
    )

    def render_out_of_order(**kwargs) -> None:
        index = int(Path(kwargs["out_path"]).stem.split("_")[-1])
        time.sleep({0: 0.06, 1: 0.01, 2: 0.03}[index])
        Path(kwargs["out_path"]).write_bytes(b"segment")

    monkeypatch.setattr(tasks, "_render_ranking_segment", render_out_of_order)

    def fake_run(command, **_kwargs):
        Path(command[-1]).write_bytes(b"0" * 2048)
        return Mock(returncode=0, stderr=b"")

    monkeypatch.setattr(tasks.subprocess, "run", fake_run)

    class Storage:
        async def upload(self, _file, _key, _content_type):
            return "https://cdn.example/ranking.mp4"

    monkeypatch.setattr(storage_base, "get_storage", lambda _provider: Storage())

    class Session:
        def execute(self, *_args, **_kwargs):
            return Mock()

    @contextmanager
    def fake_session(_tenant_id):
        yield Session()

    monkeypatch.setattr(tasks, "_get_session", fake_session)
    monkeypatch.setattr(tasks, "_ai_generate_clip_content", lambda *_args, **_kwargs: None)

    _run_ranking(_segments(3))

    rendered = [event for event in events if event["step"].startswith("rendered_")]
    assert [event["pct"] for event in rendered] == sorted(event["pct"] for event in rendered)
    assert [event["message"] for event in rendered] == [
        "Rendered 1/3 segments",
        "Rendered 2/3 segments",
        "Rendered 3/3 segments",
    ]
    captions_index = timeline.index(("event", "captions"))
    ready_index = next(
        index
        for index, item in enumerate(timeline)
        if item[0] == "database" and item[1].get("status") == "ready"
    )
    complete_index = timeline.index(("event", "complete"))
    assert captions_index < ready_index < complete_index


def test_reconciler_does_not_fail_queued_ranking_jobs(monkeypatch):
    statements: list[str] = []

    class Rows:
        def __init__(self, statement: str):
            self.statement = statement

        def fetchall(self):
            base = ("video-id", "tenant-id", None, {}, "queued", 0)
            return [(*base, "ranking", {})] if "source_type" in self.statement else [base]

    class Session:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, statement, *_args, **_kwargs):
            sql = str(statement)
            statements.append(sql)
            return Rows(sql)

        def commit(self):
            pass

    monkeypatch.setattr(tasks, "Session", lambda _engine: Session())

    result = tasks.reconcile_stuck_videos.apply(task_id="reconcile-job", throw=True).get()

    assert result == {"requeued": 0, "failed": 0}
    assert not any("UPDATE videos SET status='failed'" in statement for statement in statements)


def test_publish_progress_keeps_latest_event_and_is_best_effort(monkeypatch):
    redis = Mock()
    monkeypatch.setattr(core, "redis_client", redis)

    core._publish_progress("job-id", "rendering", 40, "processing", "Rendered 1/3 segments")

    cached = redis.setex.call_args.args
    assert cached[:2] == ("job:job-id:progress:last", 3600)
    assert json.loads(cached[2]) == {
        "job_id": "job-id",
        "step": "rendering",
        "pct": 40,
        "status": "processing",
        "message": "Rendered 1/3 segments",
    }
    redis.publish.assert_called_once_with("job:job-id:progress", cached[2])

    redis.setex.side_effect = ConnectionError("redis unavailable")
    redis.publish.side_effect = ConnectionError("redis unavailable")
    core._publish_progress("job-id", "rendering", 50, "processing", "Rendered 2/3 segments")


def test_publish_clip_event_is_best_effort(monkeypatch):
    redis = Mock()
    redis.publish.side_effect = ConnectionError("redis unavailable")
    monkeypatch.setattr(core, "redis_client", redis)

    core._publish_clip_event("job-id", "clip_ready", {"video_id": "video-id"})
