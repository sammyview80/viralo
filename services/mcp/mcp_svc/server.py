"""MCP service entrypoint. No DB access — all data via shared/client to existing services."""
from fastapi import Depends, FastAPI
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from mcp_svc.auth import router as auth_router
from mcp_svc.tools import clips, publish, social, workspace, status

app = FastAPI(title="Viralo MCP Service")
app.include_router(auth_router)

bearer_scheme = HTTPBearer()


def _token(creds: HTTPAuthorizationCredentials = Depends(bearer_scheme)) -> str:
    return creds.credentials


@app.get("/tools/list_clips")
async def tool_list_clips(video_id: str, token: str = Depends(_token)):
    return await clips.list_clips(token, video_id)


@app.get("/tools/get_clip")
async def tool_get_clip(clip_id: str, token: str = Depends(_token)):
    return await clips.get_clip(token, clip_id)


@app.post("/tools/publish_clip")
async def tool_publish_clip(post_id: str, token: str = Depends(_token)):
    return await publish.publish_clip(token, post_id)


@app.post("/tools/schedule_clip")
async def tool_schedule_clip(payload: dict, token: str = Depends(_token)):
    return await publish.schedule_clip(token, payload)


@app.get("/tools/list_social_accounts")
async def tool_list_social_accounts(token: str = Depends(_token)):
    return await social.list_social_accounts(token)


@app.get("/tools/get_workspace_context")
async def tool_get_workspace_context(tenant_id: str, token: str = Depends(_token)):
    return await workspace.get_workspace_context(token, tenant_id)


@app.get("/tools/get_job_status")
async def tool_get_job_status(clip_id: str, render_id: str, token: str = Depends(_token)):
    return await status.get_job_status(token, clip_id, render_id)