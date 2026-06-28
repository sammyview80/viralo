import pytest
from pydantic import ValidationError

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
