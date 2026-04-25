"""FastAPI entrypoint for the frame-mog backend."""

from __future__ import annotations

import logging
import os
from functools import lru_cache

from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic_ai import Agent

from .auth import require_auth
from .billing import (
    CONFIG,
    add_credits,
    check_rate_limit,
    create_checkout_session,
    credit_refund_for_failed_job,
    get_account_state,
    handle_stripe_webhook,
    init_billing_store,
    spend_credits,
)
from .mubit_memory import get_mubit_memory
from .pose_variants import (
    GENERATED_ROOT,
    cancel_pose_variant_job,
    count_active_pose_jobs,
    count_user_active_pose_jobs,
    create_pose_variant_job,
    get_pose_variant_job,
    reorder_pose_variants,
    run_pose_variant_job,
    set_pose_variant_owner,
    set_pose_variant_personalization,
)
from .schemas import (
    BillingAccountResponse,
    CheckoutRequest,
    CheckoutResponse,
    GuidanceResponse,
    Landmark,
    MemoryFeedbackRequest,
    MemoryOnboardingRequest,
    MemoryPreferencesRequest,
    MemoryResetRequest,
    MemoryStatusResponse,
    PoseContext,
    PoseVariantJob,
    TemplateMeta,
)
from .templates import TEMPLATES

load_dotenv()

logger = logging.getLogger(__name__)

AGENT_MODEL = os.environ.get("AGENT_MODEL", "gateway/openai:gpt-5.3")

SYSTEM_PROMPT = """\
You are a real-time photo-posing coach. Each request represents one pose sample
taken about once per second. You receive a small set of 2D body landmarks and
the template the client's local matcher picked. Respond with a GuidanceResponse:

- recommended_template_id MUST be one of the provided ids.
- guidance MUST be short (<=120 characters), friendly, and actionable.
- Set person_visible=false if the key landmarks are missing or low-visibility.
- Set pose_aligned=true only if the user is clearly already in the template.
- Set suggest_different=true if a different template fits better.
- reason is one short sentence explaining your decision.
"""


def _summarize_landmarks(lm: list[Landmark]) -> str:
    if not lm:
        return "no landmarks"
    important = {
        11: "L-shoulder", 12: "R-shoulder",
        13: "L-elbow", 14: "R-elbow",
        15: "L-wrist", 16: "R-wrist",
        23: "L-hip", 24: "R-hip",
        25: "L-knee", 26: "R-knee",
        27: "L-ankle", 28: "R-ankle",
    }
    parts: list[str] = []
    for idx, name in important.items():
        if idx < len(lm):
            p = lm[idx]
            parts.append(f"{name}=({p.x:.2f},{p.y:.2f},v={p.visibility:.2f})")
    return "; ".join(parts)


def _render_prompt(ctx: PoseContext) -> str:
    tmpl_lines = "\n".join(
        f"- {t.id} ({t.posture}): {t.description}" for t in TEMPLATES
    )
    return (
        f"Available pose templates:\n{tmpl_lines}\n\n"
        f"Client candidate: {ctx.candidate_template_id}\n"
        f"Client confidence: {ctx.local_confidence:.2f}\n"
        f"Image size: {ctx.image_wh[0]}x{ctx.image_wh[1]}\n"
        f"Landmark summary: {_summarize_landmarks(ctx.landmarks)}\n\n"
        "Return a GuidanceResponse telling the user what to do next."
    )


@lru_cache(maxsize=1)
def get_agent() -> Agent[None, GuidanceResponse]:
    """Build the Pydantic AI agent on first use.

    Lazy so importing this module doesn't require a gateway key — handy for
    tests and for the /api/templates endpoint which doesn't touch the model.
    """
    return Agent(
        AGENT_MODEL,
        output_type=GuidanceResponse,
        system_prompt=SYSTEM_PROMPT,
    )

app = FastAPI(title="frame-mog")
GENERATED_ROOT.mkdir(parents=True, exist_ok=True)
app.mount("/generated", StaticFiles(directory=GENERATED_ROOT), name="generated")
init_billing_store()

_allowed_origins = os.environ.get(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174",
).split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _allowed_origins if o.strip()],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": AGENT_MODEL}


@app.get("/api/templates", response_model=list[TemplateMeta])
def list_templates(_user_id: str = Depends(require_auth)) -> list[TemplateMeta]:
    return TEMPLATES


def _client_ip(request: Request) -> str:
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _enforce_guidance_limits(user_id: str, request: Request) -> None:
    check_rate_limit(
        f"guidance:user:{user_id}",
        max_count=CONFIG.guidance_rate_per_hour,
        window_seconds=60 * 60,
    )
    check_rate_limit(
        f"guidance:ip:{_client_ip(request)}",
        max_count=max(CONFIG.guidance_rate_per_hour * 2, 60),
        window_seconds=60 * 60,
    )


def _enforce_pose_job_limits(user_id: str, request: Request) -> None:
    account = get_account_state(user_id)
    per_day_limit = (
        CONFIG.pose_jobs_per_day_paid if account["plan_type"] != "free" else CONFIG.pose_jobs_per_day_free
    )
    check_rate_limit(
        f"pose:user:{user_id}",
        max_count=per_day_limit,
        window_seconds=24 * 60 * 60,
    )
    check_rate_limit(
        f"pose:ip:{_client_ip(request)}",
        max_count=max(per_day_limit * 2, 10),
        window_seconds=24 * 60 * 60,
    )
    check_rate_limit(
        "pose:global:hour",
        max_count=CONFIG.max_pose_jobs_per_hour_global,
        window_seconds=60 * 60,
    )
    global_active = count_active_pose_jobs()
    if global_active >= int(os.environ.get("MAX_CONCURRENT_POSE_JOBS_GLOBAL", "12")):
        raise HTTPException(
            status_code=429,
            detail={"code": "global_capacity_reached", "message": "Generation capacity is currently full."},
        )
    user_active = count_user_active_pose_jobs(user_id)
    if user_active >= int(os.environ.get("MAX_ACTIVE_POSE_JOBS_PER_USER", "2")):
        raise HTTPException(
            status_code=429,
            detail={"code": "user_capacity_reached", "message": "Too many active jobs for this user."},
        )


@app.post("/api/guidance", response_model=GuidanceResponse)
async def guidance(
    ctx: PoseContext,
    request: Request,
    user_id: str = Depends(require_auth),
) -> GuidanceResponse:
    _enforce_guidance_limits(user_id, request)
    spend_credits(
        user_id,
        amount=CONFIG.guidance_cost,
        event_type="guidance_request",
    )
    try:
        result = await get_agent().run(_render_prompt(ctx))
    except Exception as exc:  # noqa: BLE001 — surface all provider errors uniformly
        logger.exception("Guidance agent failed")
        add_credits(
            user_id,
            amount=CONFIG.guidance_cost,
            event_type="guidance_refund",
            metadata={"reason": "provider_error"},
        )
        raise HTTPException(status_code=502, detail=f"agent error: {exc}") from exc
    return result.output


@app.post("/api/pose-variants", response_model=PoseVariantJob)
async def create_pose_variants(
    background_tasks: BackgroundTasks,
    request: Request,
    reference_image: UploadFile = File(...),
    user_id: str = Depends(require_auth),
) -> PoseVariantJob:
    if not reference_image.content_type or not reference_image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="reference_image must be an image")
    _enforce_pose_job_limits(user_id, request)

    job = await create_pose_variant_job(reference_image)
    set_pose_variant_owner(job.job_id, user_id)
    try:
        spend_credits(
            user_id,
            amount=CONFIG.pose_variant_cost,
            event_type="pose_variant_job",
            event_ref=job.job_id,
        )
    except HTTPException:
        cancel_pose_variant_job(job.job_id)
        raise
    memory = get_mubit_memory()
    if memory:
        order = memory.rank_pose_candidates(
            user_id=user_id,
            scene_tags=["camera_live", "pose_variants"],
            candidates=[
                {"id": "pose-01", "title": "Crossed arms", "prompt": "arms crossed"},
                {"id": "pose-02", "title": "Relaxed turn", "prompt": "relaxed turn"},
                {"id": "pose-03", "title": "Thoughtful", "prompt": "hand near chin"},
                {"id": "pose-04", "title": "Look away", "prompt": "side look"},
                {"id": "pose-05", "title": "Hands forward", "prompt": "hands forward"},
                {"id": "pose-06", "title": "Angled cross", "prompt": "angled crossed arms"},
                {"id": "pose-07", "title": "Hand on cheek", "prompt": "hand near cheek"},
                {"id": "pose-08", "title": "Over shoulder", "prompt": "look over shoulder"},
                {"id": "pose-09", "title": "Lean in", "prompt": "lean toward camera"},
                {"id": "pose-10", "title": "Calm profile", "prompt": "calm profile"},
            ],
        )
        reorder_pose_variants(order)
        personalization = memory.get_personalization_block(
            user_id=user_id,
            scene_tags=["camera_live", "pose_variants"],
        )
        if personalization:
            set_pose_variant_personalization(job.job_id, personalization)
    background_tasks.add_task(
        run_pose_variant_job,
        job.job_id,
        on_failed=lambda failed_job_id: credit_refund_for_failed_job(user_id, failed_job_id),
        timeout_seconds=int(os.environ.get("POSE_VARIANT_JOB_TIMEOUT_SECONDS", "180")),
    )
    return job


@app.get("/api/pose-variants/{job_id}", response_model=PoseVariantJob)
def get_pose_variants(job_id: str) -> PoseVariantJob:
    job = get_pose_variant_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="pose variant job not found")
    return job


@app.post("/api/memory/onboarding", response_model=MemoryStatusResponse)
def seed_memory_onboarding(
    payload: MemoryOnboardingRequest,
    user_id: str = Depends(require_auth),
) -> MemoryStatusResponse:
    memory = get_mubit_memory()
    if not memory:
        return MemoryStatusResponse(ok=False)
    memory.remember_onboarding_seed(
        user_id=user_id,
        entries=[entry.model_dump() for entry in payload.entries],
    )
    return MemoryStatusResponse(ok=True)


@app.post("/api/memory/feedback", response_model=MemoryStatusResponse)
def record_memory_feedback(
    payload: MemoryFeedbackRequest,
    user_id: str = Depends(require_auth),
) -> MemoryStatusResponse:
    check_rate_limit(
        f"memory:feedback:{user_id}",
        max_count=CONFIG.memory_writes_per_hour,
        window_seconds=60 * 60,
    )
    memory = get_mubit_memory()
    if not memory:
        return MemoryStatusResponse(ok=False)
    memory.remember_feedback(
        user_id=user_id,
        event=payload.event,
        pose_template_id=payload.pose_template_id,
        scene_tags=payload.scene_tags,
        outcome_score=payload.outcome_score,
    )
    return MemoryStatusResponse(ok=True)


@app.post("/api/memory/preferences", response_model=MemoryStatusResponse)
def set_memory_preferences(
    payload: MemoryPreferencesRequest,
    user_id: str = Depends(require_auth),
) -> MemoryStatusResponse:
    check_rate_limit(
        f"memory:preferences:{user_id}",
        max_count=CONFIG.memory_writes_per_hour,
        window_seconds=60 * 60,
    )
    memory = get_mubit_memory()
    if not memory:
        return MemoryStatusResponse(ok=False)
    memory.remember_preferences(
        user_id=user_id,
        allow_camera_roll=payload.allow_camera_roll,
        allow_instagram=payload.allow_instagram,
        allow_pinterest=payload.allow_pinterest,
    )
    return MemoryStatusResponse(ok=True)


@app.post("/api/memory/reset", response_model=MemoryStatusResponse)
def reset_memory_profile(
    payload: MemoryResetRequest,
    user_id: str = Depends(require_auth),
) -> MemoryStatusResponse:
    check_rate_limit(
        f"memory:reset:{user_id}",
        max_count=max(CONFIG.memory_writes_per_hour // 4, 10),
        window_seconds=60 * 60,
    )
    memory = get_mubit_memory()
    if not memory:
        return MemoryStatusResponse(ok=False)
    memory.reset_user_memory(user_id=user_id, hard_reset=payload.hard_reset)
    return MemoryStatusResponse(ok=True)


@app.get("/api/billing/account", response_model=BillingAccountResponse)
def get_billing_account(user_id: str = Depends(require_auth)) -> BillingAccountResponse:
    return BillingAccountResponse(**get_account_state(user_id))


@app.post("/api/billing/checkout", response_model=CheckoutResponse)
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


@app.post("/api/billing/webhook")
async def stripe_webhook(
    request: Request,
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
) -> dict[str, object]:
    body = await request.body()
    return handle_stripe_webhook(body, stripe_signature)
