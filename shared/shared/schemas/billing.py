from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class PlanOut(BaseModel):
    id: uuid.UUID
    name: str
    price_monthly: Decimal
    videos_per_month: int
    storage_gb: int
    brainstorm: bool
    workflows: bool
    channels: bool
    watermark: bool
    accounts_per_platform: int
    video_duration_limit_min: int | None

    model_config = {"from_attributes": True}


class SubscriptionOut(BaseModel):
    plan_name: str
    status: str
    billing_cycle: str
    current_period_end: datetime | None
    cancel_at_period_end: bool
    videos_used: int
    storage_bytes_used: int
    brainstorm_used: int

    model_config = {"from_attributes": True}


class CheckoutRequest(BaseModel):
    plan_name: str          # starter|pro|creator|unlimited
    billing_cycle: str = "monthly"  # monthly|yearly
    success_url: str
    cancel_url: str


class EsewaQRResponse(BaseModel):
    merchant_id: str
    amount_npr: int
    product_id: str
    plan_name: str
    instructions: str
