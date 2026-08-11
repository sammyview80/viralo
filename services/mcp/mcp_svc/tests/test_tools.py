"""MCP Tool Unit Tests (pytest-asyncio)."""

import pytest
from unittest.mock import AsyncMock, MagicMock
from services.mcp.mcp_svc.tools import (
    clips, publish, social, workspace, status
)


@pytest.mark.asyncio
async def test_clips_list(bearer_token):
    mock_resp = AsyncMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = [{"id": "clip1", "title": "Test Clip"}]
    mock_client = AsyncMock(return_value=mock_resp)
    with pytest.MonkeyPatch.context() as m:
        m.setattr("services.mcp.mcp_svc.tools.clips.ServiceClient", lambda token: mock_client)
        result = await clips.list_clips(bearer_token, "video123")
        assert result == [{"id": "clip1", "title": "Test Clip"}]
        mock_client.get.assert_awaited_once()


@pytest.mark.asyncio
async def test_publish_clip(bearer_token):
    mock_resp = AsyncMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"status": "ok"}
    mock_client = AsyncMock(return_value=mock_resp)
    with pytest.MonkeyPatch.context() as m:
        m.setattr("services.mcp.mcp_svc.tools.publish.ServiceClient", lambda token: mock_client)
        result = await publish.publish_clip(bearer_token, "post456")
        assert result == {"status": "ok"}
        mock_client.post.assert_awaited_once()


@pytest.mark.asyncio
async def test_social_list(bearer_token):
    mock_resp = AsyncMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = [{"platform": "tiktok"}]
    mock_client = AsyncMock(return_value=mock_resp)
    with pytest.MonkeyPatch.context() as m:
        m.setattr("services.mcp.mcp_svc.tools.social.ServiceClient", lambda token: mock_client)
        result = await social.list_social_accounts(bearer_token)
        assert result == [{"platform": "tiktok"}]
        mock_client.get.assert_awaited_once()


@pytest.mark.asyncio
async def test_workspace_context(bearer_token, tenant_id="tenant1"):
    mock_resp = AsyncMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"tenant_id": tenant_id, "name": "Test"}
    mock_client = AsyncMock(return_value=mock_resp)
    with pytest.MonkeyPatch.context() as m:
        m.setattr("services.mcp.mcp_svc.tools.workspace.ServiceClient", lambda token: mock_client)
        result = await workspace.get_workspace_context(bearer_token, tenant_id)
        assert result["tenant_id"] == tenant_id
        mock_client.get.assert_awaited_once()


@pytest.mark.asyncio
async def test_status_check(bearer_token, clip_id="clip1", render_id="render1"):
    mock_resp = AsyncMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"status": "completed", "progress": 100}
    mock_client = AsyncMock(return_value=mock_resp)
    with pytest.MonkeyPatch.context() as m:
        m.setattr("services.mcp.mcp_svc.tools.status.ServiceClient", lambda token: mock_client)
        result = await status.get_render_status(bearer_token, clip_id, render_id)
        assert result["status"] == "completed"
        mock_client.get.assert_awaited_once()
