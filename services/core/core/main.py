from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from shared.middleware.tenant import TenantMiddleware
from core.routers import auth, tenants, onboarding

app = FastAPI(title="Viralo Core Service", version="0.1.0")

app.add_middleware(TenantMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(tenants.router, prefix="/api/v1")
app.include_router(onboarding.router, prefix="/api/v1")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "core"}
