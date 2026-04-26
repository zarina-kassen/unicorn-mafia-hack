"""Routes for billing, credits, and Stripe checkout."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Request

from ..auth.clerk import require_auth
from ..billing import (
    create_checkout_session,
    get_account_state,
    handle_stripe_webhook,
)
from ..schemas import BillingAccountResponse, CheckoutRequest, CheckoutResponse

router = APIRouter(prefix="/api/billing", tags=["billing"])


@router.get("/account", response_model=BillingAccountResponse)
def get_billing_account(
    user_id: str = Depends(require_auth),
) -> BillingAccountResponse:
    return BillingAccountResponse(**get_account_state(user_id))


@router.post("/checkout", response_model=CheckoutResponse)
def start_checkout(
    payload: CheckoutRequest,
    user_id: str = Depends(require_auth),
) -> CheckoutResponse:
    session = create_checkout_session(
        user_id=user_id,
        pack_id=payload.pack_id,
        success_url=payload.success_url,
        cancel_url=payload.cancel_url,
    )
    return CheckoutResponse(**session)


@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
) -> dict[str, object]:
    body = await request.body()
    return handle_stripe_webhook(body, stripe_signature)
