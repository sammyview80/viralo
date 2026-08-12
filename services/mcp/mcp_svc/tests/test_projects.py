"""MCP list_projects / get_project_details tool tests (pytest-asyncio)."""

import pytest
from unittest.mock import AsyncMock, MagicMock

from mcp_svc.client import UpstreamServiceError
from mcp_svc.tools import get_project_details, list_projects

TOKEN = "test-token"


def _mock_service_client(monkeypatch, module, get_side_effect):
    mock_client = AsyncMock()
    mock_client.get.side_effect = get_side_effect
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = False
    monkeypatch.setattr(module, "ServiceClient", lambda token: mock_client)
    return mock_client


@pytest.mark.asyncio
async def test_list_projects_success(monkeypatch):
    resp = MagicMock()
    resp.json.return_value = {"items": [{"id": "vid1", "title": "My Video"}], "page": 1}
    mock_client = _mock_service_client(monkeypatch, list_projects, get_side_effect=[resp])

    result = await list_projects.list_projects(TOKEN, page=1, per_page=20)

    assert result == {"items": [{"id": "vid1", "title": "My Video"}], "page": 1}
    mock_client.get.assert_awaited_once()
    mock_client.__aexit__.assert_awaited_once()


@pytest.mark.asyncio
async def test_list_projects_applies_status_filter(monkeypatch):
    resp = MagicMock()
    resp.json.return_value = {"items": []}
    mock_client = _mock_service_client(monkeypatch, list_projects, get_side_effect=[resp])

    await list_projects.list_projects(TOKEN, status_filter="processing")

    _, kwargs = mock_client.get.call_args
    assert kwargs["params"]["status"] == "processing"


@pytest.mark.asyncio
async def test_list_projects_all_status_omits_filter(monkeypatch):
    resp = MagicMock()
    resp.json.return_value = {"items": []}
    mock_client = _mock_service_client(monkeypatch, list_projects, get_side_effect=[resp])

    await list_projects.list_projects(TOKEN, status_filter="all")

    _, kwargs = mock_client.get.call_args
    assert "status" not in kwargs["params"]


@pytest.mark.asyncio
async def test_get_project_details_includes_clips(monkeypatch):
    video_resp = MagicMock()
    video_resp.json.return_value = {"id": "vid1", "title": "My Video"}
    clips_resp = MagicMock()
    clips_resp.json.return_value = {"items": [{"id": "clip1"}]}
    mock_client = _mock_service_client(
        monkeypatch, get_project_details, get_side_effect=[video_resp, clips_resp]
    )

    result = await get_project_details.get_project_details(TOKEN, "vid1", include_clips=True)

    assert result["id"] == "vid1"
    assert result["clips"] == [{"id": "clip1"}]
    assert mock_client.get.await_count == 2


@pytest.mark.asyncio
async def test_get_project_details_clips_404_becomes_empty_list(monkeypatch):
    video_resp = MagicMock()
    video_resp.json.return_value = {"id": "vid1"}
    mock_client = _mock_service_client(
        monkeypatch,
        get_project_details,
        get_side_effect=[video_resp, UpstreamServiceError(404, "not found")],
    )

    result = await get_project_details.get_project_details(TOKEN, "vid1", include_clips=True)

    assert result["clips"] == []


@pytest.mark.asyncio
async def test_get_project_details_clips_403_is_not_swallowed(monkeypatch):
    video_resp = MagicMock()
    video_resp.json.return_value = {"id": "vid1"}
    mock_client = _mock_service_client(
        monkeypatch,
        get_project_details,
        get_side_effect=[video_resp, UpstreamServiceError(403, "forbidden")],
    )

    with pytest.raises(UpstreamServiceError) as exc_info:
        await get_project_details.get_project_details(TOKEN, "vid1", include_clips=True)

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_get_project_details_no_fabricated_stats(monkeypatch):
    video_resp = MagicMock()
    video_resp.json.return_value = {"id": "vid1"}
    mock_client = _mock_service_client(
        monkeypatch, get_project_details, get_side_effect=[video_resp]
    )

    result = await get_project_details.get_project_details(TOKEN, "vid1", include_clips=False)

    assert "stats" not in result
