"""Test MCP clips tool stub."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from services.mcp.mcp_svc.tools.clips import list_clips, get_clip

@pytest.mark.asyncio
async def test_list_clips_success():
    \"\"\"Test successful clip listing.\"\"\"
    with patch('services.mcp.mcp_svc.tools.clips.Client') as mock_client:
        mock_client_instance = MagicMock()
        mock_client_instance.get = AsyncMock(return_value=MagicMock(
            json=AsyncMock(return_value=[{"id": "clip1", "title": "Test Clip"}])
        ))
        mock_client_instance.raise_for_status = AsyncMock()
        mock_client_instance.get.return_value = MagicMock(json=AsyncMock(return_value=[{"id": "clip1", "title": "Test Clip"}]))
        mock_client_instance.raise_for_status = AsyncMock()
        mock_client_instance.post = AsyncMock(return_value=MagicMock(json=AsyncMock(return_value={})))
        mock_client_instance.get = AsyncMock(return_value=MagicMock(json=AsyncMock(return_value=[])))

        await list_clips("token", "video123")
        mock_client_instance.get.assert_called_once()
