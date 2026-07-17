import asyncio
import json
import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from video.routers import videos
from video.routers.videos import CreateRankingRequest


def _payload(**segment_overrides):
    segment = {
        "source_type": "url",
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "start_sec": 2.5,
        "end_sec": 12.5,
        "segment_title": "Hook",
    }
    segment.update(segment_overrides)
    return {
        "title": "Top Clips",
        "segments": [
            segment,
            {**segment, "segment_title": "Payoff", "start_sec": 20, "end_sec": 35},
        ],
    }


def test_ranking_request_keeps_segment_trim_times():
    req = CreateRankingRequest(**_payload(start_sec=4.25, end_sec=9.75))

    assert req.segments[0].start_sec == 4.25
    assert req.segments[0].end_sec == 9.75


def test_ranking_request_rejects_negative_start_time():
    with pytest.raises(ValidationError):
        CreateRankingRequest(**_payload(start_sec=-1, end_sec=8))


def test_ranking_request_rejects_end_before_start():
    with pytest.raises(ValidationError):
        CreateRankingRequest(**_payload(start_sec=12, end_sec=8))


@pytest.mark.asyncio
async def test_progress_stream_replays_latest_terminal_event(monkeypatch):
    tenant_id = uuid.uuid4()
    terminal = json.dumps({
        "job_id": "ranking-job",
        "step": "failed",
        "pct": 40,
        "status": "failed",
        "message": "Ranking video generation failed.",
    })

    class OwnerResult:
        def scalar_one_or_none(self):
            return uuid.uuid4()

    class Database:
        async def execute(self, _statement):
            return OwnerResult()

    class PubSub:
        async def subscribe(self, *_channels):
            pass

        async def get_message(self, **_kwargs):
            await asyncio.sleep(0.01)
            return None

        async def unsubscribe(self, *_channels):
            pass

        async def aclose(self):
            pass

    class Redis:
        def pubsub(self):
            return PubSub()

        async def get(self, key):
            assert key == "job:ranking-job:progress:last"
            return terminal.encode()

    monkeypatch.setattr(
        videos,
        "_decode_access_token",
        lambda _token: SimpleNamespace(tenant_id=str(tenant_id)),
    )

    response = await videos.video_progress(
        job_id="ranking-job",
        token="token",
        redis=Redis(),
        db=Database(),
    )
    chunk = await asyncio.wait_for(anext(response.body_iterator), timeout=0.1)

    assert terminal in chunk


@pytest.mark.asyncio
async def test_ranking_enqueue_failure_marks_video_failed(monkeypatch):
    request = CreateRankingRequest(**_payload())

    class Database:
        def __init__(self):
            self.video = None
            self.commits = 0

        def add(self, video):
            self.video = video

        async def commit(self):
            self.commits += 1

    class Celery:
        def send_task(self, *_args, **_kwargs):
            raise ConnectionError("broker unavailable")

    database = Database()
    monkeypatch.setattr(videos, "_get_celery", lambda: Celery())

    with pytest.raises(HTTPException) as error:
        await videos.create_ranking(
            req=request,
            token=SimpleNamespace(tenant_id=str(uuid.uuid4())),
            db=database,
        )

    assert error.value.status_code == 503
    assert database.video.status == "failed"
    assert database.video.pipeline_step == "failed"
    assert database.video.error_message == "Could not queue ranking video. Please try again."
    assert database.commits == 2
