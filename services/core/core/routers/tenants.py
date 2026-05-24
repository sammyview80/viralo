import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.deps import get_current_user, get_db_no_rls
from shared.schemas.auth import TokenPayload
from shared.schemas.tenant import TenantResponse, TenantUpdate
from shared.models.public.tenant import Tenant

router = APIRouter(prefix="/tenants", tags=["tenants"])


@router.get("/me", response_model=TenantResponse)
async def get_my_tenant(
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
):
    result = await db.execute(select(Tenant).where(Tenant.id == uuid.UUID(token.tenant_id)))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return tenant


@router.patch("/me", response_model=TenantResponse)
async def update_my_tenant(
    body: TenantUpdate,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
):
    result = await db.execute(select(Tenant).where(Tenant.id == uuid.UUID(token.tenant_id)))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(tenant, field, value)

    await db.commit()
    await db.refresh(tenant)
    return tenant
