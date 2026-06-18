from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from shared.middleware.tenant import TenantMiddleware
from platform_svc.routers import social_accounts, scheduling, notifications, analytics, push, websub

app = FastAPI(title="Viralo Platform Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)
app.add_middleware(TenantMiddleware)

app.include_router(social_accounts.router, prefix="/api/v1")
app.include_router(scheduling.router, prefix="/api/v1")
app.include_router(notifications.router, prefix="/api/v1")
app.include_router(analytics.router, prefix="/api/v1")
app.include_router(push.router, prefix="/api/v1")
app.include_router(websub.router, prefix="/api/v1")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "platform"}
