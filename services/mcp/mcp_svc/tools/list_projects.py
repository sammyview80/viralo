"""MCP tool for listing projects (videos) — proxies video service, no DB access."""
from typing import Any

from mcp_svc.client import ServiceClient, VIDEO_SVC_BASE

# Mapping from local sort options to API sort params
SORT_MAP = {
    "newest": "created_at",
    "oldest": "created_at",
    "title": "title",
    "status": "status",
}

STATUS_FILTER_MAP = {
    "all": None,
    "ready": "done",  # Also includes "ready" status
    "processing": "processing",  # In-progress statuses
    "failed": "failed",
}


async def list_projects(token: str, page: int = 1, per_page: int = 20,
                         sort_by: str = "newest", search: str = "",
                         status_filter: str = "all") -> dict:
    """
    List all projects/videos available to the user.

    Args:
        token: Bearer token for authentication
        page: Page number (1-indexed)
        per_page: Items per page (max 100)
        sort_by: Sort order - "newest", "oldest", "title", "status"
        search: Search term to filter projects
        status_filter: Filter by status - "all", "ready", "processing", "failed"

    Returns:
        Paginated list of video projects
    """
    # Build query params
    params: dict[str, Any] = {
        "page": page,
        "per_page": per_page,
        "sort_by": SORT_MAP.get(sort_by, "created_at"),
    }

    # Add search filter if provided
    if search:
        params["search"] = search

    # Handle sorting direction for oldest
    params["order"] = "asc" if sort_by == "oldest" else "desc"

    # Apply status filter, if any
    mapped_status = STATUS_FILTER_MAP.get(status_filter)
    if mapped_status:
        params["status"] = mapped_status

    async with ServiceClient(token) as client:
        # Use the base /videos endpoint for project listing
        resp = await client.get(VIDEO_SVC_BASE, "/videos", params=params)
        return resp.json()
