"""MCP analyze_viral / create_ranking_video tool tests (pytest-asyncio)."""

import pytest
from unittest.mock import AsyncMock, MagicMock

from mcp_svc import client as client_module
from mcp_svc.mcp import TOOLS, _TOOLS_BY_NAME

TOKEN = "test-token"


def _mock_service_client(monkeypatch, post_side_effect):
    mock_client = AsyncMock()
    mock_client.post.side_effect = post_side_effect
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = False
    monkeypatch.setattr(client_module, "ServiceClient", lambda token: mock_client)
    return mock_client


# ---------------------------------------------------------------------------
# client.analyze_viral
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_analyze_viral_posts_url_and_returns_clip_moments(monkeypatch):
    resp = MagicMock()
    resp.json.return_value = {
        "viral_score": 82,
        "clip_moments": [
            {"start_sec": 4, "end_sec": 18, "reason": "hook", "clip_score": 91},
        ],
    }
    mock_client = _mock_service_client(monkeypatch, post_side_effect=[resp])

    result = await client_module.analyze_viral(TOKEN, "https://www.youtube.com/watch?v=dQw4w9WgXcQ")

    assert result["viral_score"] == 82
    assert result["clip_moments"][0]["start_sec"] == 4
    mock_client.post.assert_awaited_once()
    args, kwargs = mock_client.post.call_args
    assert args[0] == client_module.VIDEO_SVC_BASE
    assert args[1] == "/analyze-viral"
    assert kwargs["json"] == {"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}


@pytest.mark.asyncio
async def test_analyze_viral_propagates_upstream_error(monkeypatch):
    mock_client = _mock_service_client(
        monkeypatch, post_side_effect=[client_module.UpstreamServiceError(422, "bad url")]
    )

    with pytest.raises(client_module.UpstreamServiceError) as exc_info:
        await client_module.analyze_viral(TOKEN, "not-a-youtube-url")

    assert exc_info.value.status_code == 422
    mock_client.post.assert_awaited_once()


# ---------------------------------------------------------------------------
# client.create_ranking_video
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_ranking_video_builds_request_body(monkeypatch):
    resp = MagicMock()
    resp.json.return_value = {"video_id": "vid-1", "job_id": "job-1"}
    mock_client = _mock_service_client(monkeypatch, post_side_effect=[resp])

    segments = [
        {"source_type": "url", "url": "https://youtu.be/abc", "start_sec": 4, "end_sec": 18, "segment_title": "Hook"},
        {"source_type": "url", "url": "https://youtu.be/abc", "start_sec": 30, "end_sec": 45, "segment_title": "Payoff"},
    ]

    result = await client_module.create_ranking_video(TOKEN, title="Top Clips", segments=segments)

    assert result == {"video_id": "vid-1", "job_id": "job-1"}
    mock_client.post.assert_awaited_once()
    args, kwargs = mock_client.post.call_args
    assert args[0] == client_module.VIDEO_SVC_BASE
    assert args[1] == "/ranking"
    body = kwargs["json"]
    assert body["title"] == "Top Clips"
    assert body["template"] == "viral"
    assert body["order"] == "countdown"
    assert body["segments"] == segments
    assert "template_config" not in body  # omitted when not provided


@pytest.mark.asyncio
async def test_create_ranking_video_includes_template_config_when_given(monkeypatch):
    resp = MagicMock()
    resp.json.return_value = {"video_id": "vid-2", "job_id": "job-2"}
    mock_client = _mock_service_client(monkeypatch, post_side_effect=[resp])

    await client_module.create_ranking_video(
        TOKEN,
        title="Top 5",
        segments=[
            {"source_type": "url", "url": "https://youtu.be/abc", "start_sec": 0, "end_sec": 10},
            {"source_type": "url", "url": "https://youtu.be/abc", "start_sec": 10, "end_sec": 20},
        ],
        template="neon",
        order="ascending",
        template_config={"color": "blue"},
    )

    _, kwargs = mock_client.post.call_args
    body = kwargs["json"]
    assert body["template"] == "neon"
    assert body["order"] == "ascending"
    assert body["template_config"] == {"color": "blue"}


@pytest.mark.asyncio
async def test_create_ranking_video_propagates_upstream_error(monkeypatch):
    mock_client = _mock_service_client(
        monkeypatch, post_side_effect=[client_module.UpstreamServiceError(503, "queue failed")]
    )

    with pytest.raises(client_module.UpstreamServiceError) as exc_info:
        await client_module.create_ranking_video(
            TOKEN,
            title="Top Clips",
            segments=[
                {"source_type": "url", "url": "https://youtu.be/abc", "start_sec": 0, "end_sec": 10},
                {"source_type": "url", "url": "https://youtu.be/abc", "start_sec": 10, "end_sec": 20},
            ],
        )

    assert exc_info.value.status_code == 503


# ---------------------------------------------------------------------------
# mcp.py tool registration / schema
# ---------------------------------------------------------------------------

def test_analyze_viral_registered_with_required_url_schema():
    tool = _TOOLS_BY_NAME["analyze_viral"]
    schema = tool["inputSchema"]
    assert schema["required"] == ["url"]
    assert schema["properties"]["url"]["type"] == "string"


def test_create_ranking_video_registered_with_required_fields_and_segment_schema():
    tool = _TOOLS_BY_NAME["create_ranking_video"]
    schema = tool["inputSchema"]
    assert set(schema["required"]) == {"title", "segments"}

    segments_schema = schema["properties"]["segments"]
    assert segments_schema["type"] == "array"
    assert segments_schema["minItems"] == 2

    segment_item_schema = segments_schema["items"]
    assert set(segment_item_schema["required"]) == {"source_type", "start_sec", "end_sec"}
    assert segment_item_schema["properties"]["source_type"]["enum"] == ["url", "upload"]

    template_schema = schema["properties"]["template"]
    assert set(template_schema["enum"]) == {"viral", "classic", "neon", "minimal"}
    order_schema = schema["properties"]["order"]
    assert set(order_schema["enum"]) == {"countdown", "ascending"}


def test_tool_names_are_unique_and_new_tools_present():
    names = [tool["name"] for tool in TOOLS]
    assert len(names) == len(set(names))
    assert "analyze_viral" in names
    assert "create_ranking_video" in names


@pytest.mark.asyncio
async def test_analyze_viral_tool_fn_dispatches_to_client(monkeypatch):
    mock_analyze_viral = AsyncMock(return_value={"viral_score": 70, "clip_moments": []})
    monkeypatch.setattr("mcp_svc.mcp.analyze_viral", mock_analyze_viral)

    tool = _TOOLS_BY_NAME["analyze_viral"]
    result = await tool["fn"](TOKEN, {"url": "https://youtu.be/abc"})

    assert result == {"viral_score": 70, "clip_moments": []}
    mock_analyze_viral.assert_awaited_once_with(TOKEN, url="https://youtu.be/abc")


@pytest.mark.asyncio
async def test_create_ranking_video_tool_fn_dispatches_to_client(monkeypatch):
    mock_create_ranking = AsyncMock(return_value={"video_id": "vid-9", "job_id": "job-9"})
    monkeypatch.setattr("mcp_svc.mcp.create_ranking_video", mock_create_ranking)

    tool = _TOOLS_BY_NAME["create_ranking_video"]
    args = {
        "title": "Top Clips",
        "segments": [
            {"source_type": "url", "url": "https://youtu.be/abc", "start_sec": 0, "end_sec": 10},
            {"source_type": "url", "url": "https://youtu.be/abc", "start_sec": 10, "end_sec": 20},
        ],
    }
    result = await tool["fn"](TOKEN, args)

    assert result == {"video_id": "vid-9", "job_id": "job-9"}
    mock_create_ranking.assert_awaited_once_with(TOKEN, **args)


@pytest.mark.asyncio
async def test_call_tool_endpoint_wires_analyze_viral(monkeypatch):
    from mcp_svc.mcp import call_tool, ToolCallRequest

    mock_analyze_viral = AsyncMock(return_value={"viral_score": 55, "clip_moments": []})
    monkeypatch.setattr("mcp_svc.mcp.analyze_viral", mock_analyze_viral)

    payload = ToolCallRequest(name="analyze_viral", arguments={"url": "https://youtu.be/abc"})
    response = await call_tool(payload, token=TOKEN)

    assert response == {"result": {"viral_score": 55, "clip_moments": []}}
    mock_analyze_viral.assert_awaited_once_with(TOKEN, url="https://youtu.be/abc")
