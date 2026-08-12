"""MCP tool for getting project details — proxies video service, no DB access."""
from mcp_svc.client import ServiceClient, UpstreamServiceError, VIDEO_SVC_BASE


async def get_project_details(token: str, project_id: str,
                               include_clips: bool = True) -> dict:
    """
    Get detailed information about a specific project (video).

    Args:
        token: Bearer token for authentication
        project_id: The video/project ID
        include_clips: Whether to include related clips

    Returns:
        Detailed project information including metadata and, optionally, clips
    """
    async with ServiceClient(token) as client:
        # Get the video/project details from the upstream service
        resp = await client.get(VIDEO_SVC_BASE, f"/videos/{project_id}")
        video_data = resp.json()

        # Add clips if requested
        if include_clips:
            try:
                clips_resp = await client.get(VIDEO_SVC_BASE, f"/videos/{project_id}/clips")
                video_data["clips"] = clips_resp.json().get("items", [])
            except UpstreamServiceError as exc:
                if exc.status_code != 404:
                    raise
                video_data["clips"] = []

    return video_data
