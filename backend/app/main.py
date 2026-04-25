"""FastAPI entrypoint for the frame-mog backend."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import mimetypes
import os
import struct
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import AsyncIterator, cast
from urllib.parse import urlparse
from uuid import uuid4

from dotenv import load_dotenv
import httpx
from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
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
from .memory_onboarding import OnboardingImageInput, extract_memory_seed_entries
from .mubit_memory import get_mubit_memory
from .schemas import (
    BillingAccountResponse,
    CheckoutRequest,
    CheckoutResponse,
    GuidanceResponse,
    Landmark,
    MemoryPreferencesRequest,
    MemoryResetRequest,
    MemoryStatusResponse,
    PoseContext,
    PoseMaskRequest,
    PoseMaskResponse,
    PoseVariantJob,
    PoseVariantResult,
    TemplateMeta,
)
from .templates import TEMPLATES

load_dotenv(override=True)

logger = logging.getLogger(__name__)
MAX_ONBOARDING_IMAGES = 5
MAX_ONBOARDING_IMAGE_BYTES = 8 * 1024 * 1024

AGENT_MODEL = os.environ.get("AGENT_MODEL", "gateway/openai:gpt-5.3")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = os.environ.get(
    "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"
)
FAST_IMAGE_MODEL = os.environ.get("FAST_IMAGE_MODEL", "black-forest-labs/flux-schnell")
HQ_IMAGE_MODEL = os.environ.get("HQ_IMAGE_MODEL", "openai/gpt-image-1")
POSE_VARIANT_TOTAL = 6
# Mask extraction should default to the faster/cheaper tier, independent from HQ variants.
MASK_MODEL = os.environ.get("MASK_MODEL", FAST_IMAGE_MODEL)

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
        11: "L-shoulder",
        12: "R-shoulder",
        13: "L-elbow",
        14: "R-elbow",
        15: "L-wrist",
        16: "R-wrist",
        23: "L-hip",
        24: "R-hip",
        25: "L-knee",
        26: "R-knee",
        27: "L-ankle",
        28: "R-ankle",
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


def _normalize_local_image_path(image_url: str) -> Path | None:
    parsed = urlparse(image_url)
    path = parsed.path if parsed.scheme else image_url
    if not path.startswith("/generated/"):
        return None
    candidate = (generated_dir / path.removeprefix("/generated/")).resolve()
    try:
        candidate.relative_to(generated_dir.resolve())
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


async def _image_url_to_model_input(image_url: str) -> str:
    if image_url.startswith("data:"):
        return image_url
    local = _normalize_local_image_path(image_url)
    if local is not None:
        mime = mimetypes.guess_type(local.name)[0] or "image/png"
        b64 = base64.b64encode(local.read_bytes()).decode("ascii")
        return f"data:{mime};base64,{b64}"
    return image_url


def _image_dimensions_from_bytes(data: bytes) -> tuple[int, int] | None:
    if len(data) < 24:
        return None
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    if data.startswith(b"\xff\xd8"):
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC9, 0xCA, 0xCB}:
                h = struct.unpack(">H", data[i + 5 : i + 7])[0]
                w = struct.unpack(">H", data[i + 7 : i + 9])[0]
                return w, h
            if i + 4 >= len(data):
                break
            block = struct.unpack(">H", data[i + 2 : i + 4])[0]
            i += 2 + block
    return None


async def _store_mask_image(b64_or_url: str) -> tuple[str, int, int]:
    if b64_or_url.startswith("http://") or b64_or_url.startswith("https://"):
        return b64_or_url, 1024, 1536
    raw_b64 = (
        b64_or_url.split(",", 1)[1] if b64_or_url.startswith("data:") else b64_or_url
    )
    binary = base64.b64decode(raw_b64)
    dims = _image_dimensions_from_bytes(binary) or (1024, 1536)
    file_name = f"{uuid4().hex}-mask.png"
    out_path = generated_dir / file_name
    out_path.write_bytes(binary)
    return f"/generated/{file_name}", dims[0], dims[1]


async def _llm_extract_pose_mask(image_url: str) -> tuple[str, int, int]:
    if not OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY is not set")
    model_input = await _image_url_to_model_input(image_url)
    prompt = (
        "Create a person segmentation matte from this image.\n"
        "Output exactly one mask image with these strict rules:\n"
        "- Main person silhouette must be solid white (#FFFFFF)\n"
        "- Background must be solid black (#000000), no checkerboard pattern\n"
        "- No text, no borders, no shadows, no gradients, no background remnants\n"
        "- Preserve the SAME subject pose, camera angle, framing, position, and scale from source\n"
        "- Do NOT re-center, re-pose, re-frame, or beautify the subject\n"
        "- Output must be pixel-aligned to the original subject silhouette"
    )
    payload = {
        "model": MASK_MODEL,
        "modalities": ["image"],
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": model_input}},
                ],
            }
        ],
    }
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    timeout = httpx.Timeout(45.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        res = await client.post(
            f"{OPENROUTER_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
        )
        if res.status_code >= 400:
            detail = res.text
            try:
                payload_err = res.json()
                if isinstance(payload_err, dict):
                    err = payload_err.get("error")
                    if isinstance(err, dict):
                        msg = err.get("message")
                        code = err.get("code")
                        if isinstance(msg, str) and msg.strip():
                            detail = msg.strip()
                        if code is not None:
                            detail = f"{detail} (code: {code})"
            except Exception:  # noqa: BLE001
                pass
            raise RuntimeError(f"Mask model failed ({res.status_code}): {detail}")
        body = res.json()
    data = body.get("data") or []
    if data:
        first = data[0]
        b64 = first.get("b64_json")
        if isinstance(b64, str) and b64:
            return await _store_mask_image(b64)
        url = first.get("url") or first.get("image_url")
        if isinstance(url, str):
            return await _store_mask_image(url)

    images = body.get("images") or []
    if images:
        first = images[0]
        b64 = first.get("b64_json")
        if isinstance(b64, str) and b64:
            return await _store_mask_image(b64)
        image_url = first.get("image_url") or first.get("url")
        if isinstance(image_url, str):
            return await _store_mask_image(image_url)
        if isinstance(image_url, dict) and isinstance(image_url.get("url"), str):
            return await _store_mask_image(image_url["url"])

    choices = body.get("choices") or []
    if choices:
        message = choices[0].get("message") or {}
        message_images = message.get("images") or []
        if message_images:
            first = message_images[0]
            b64 = first.get("b64_json")
            if isinstance(b64, str) and b64:
                return await _store_mask_image(b64)
            image_url = first.get("image_url") or first.get("url")
            if isinstance(image_url, str):
                return await _store_mask_image(image_url)
            if isinstance(image_url, dict) and isinstance(image_url.get("url"), str):
                return await _store_mask_image(image_url["url"])

        content = message.get("content")
        if isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "image_url":
                    image_url = part.get("image_url")
                    if isinstance(image_url, str):
                        return await _store_mask_image(image_url)
                    if isinstance(image_url, dict) and isinstance(
                        image_url.get("url"), str
                    ):
                        return await _store_mask_image(image_url["url"])
                if part.get("type") == "image_base64" and isinstance(
                    part.get("data"), str
                ):
                    return await _store_mask_image(part["data"])

    raise RuntimeError(f"Unsupported mask response shape from OpenRouter: {body}")


@lru_cache(maxsize=1)
def get_agent() -> Agent[None, GuidanceResponse]:
    """Build the Pydantic AI agent on first use.

    Lazy so importing this module doesn't require a gateway key — handy for
    tests and for the /api/templates endpoint which doesn't touch the model.
    """
    return cast(
        Agent[None, GuidanceResponse],
        Agent(
            AGENT_MODEL,
            output_type=GuidanceResponse,
            system_prompt=SYSTEM_PROMPT,
        ),
    )


app = FastAPI(title="frame-mog")
_jobs_lock = asyncio.Lock()
_pose_jobs: dict[str, "PoseJobState"] = {}
_pose_job_owners: dict[str, str] = {}

generated_dir = Path(__file__).resolve().parent.parent / "generated"
generated_dir.mkdir(parents=True, exist_ok=True)
app.mount("/generated", StaticFiles(directory=generated_dir), name="generated")
init_billing_store()

_allowed_origins = os.environ.get(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
).split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _allowed_origins if o.strip()],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _client_ip(request: Request) -> str:
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def count_active_pose_jobs() -> int:
    return sum(
        1 for s in _pose_jobs.values() if s.job.status in ("queued", "generating")
    )


def count_user_active_pose_jobs(user_id: str) -> int:
    return sum(
        1
        for jid, s in _pose_jobs.items()
        if _pose_job_owners.get(jid) == user_id
        and s.job.status in ("queued", "generating")
    )


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
        CONFIG.pose_jobs_per_day_paid
        if account["plan_type"] != "free"
        else CONFIG.pose_jobs_per_day_free
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
    if count_active_pose_jobs() >= int(
        os.environ.get("MAX_CONCURRENT_POSE_JOBS_GLOBAL", "12")
    ):
        raise HTTPException(
            status_code=429,
            detail={
                "code": "global_capacity_reached",
                "message": "Generation capacity is currently full.",
            },
        )
    if count_user_active_pose_jobs(user_id) >= int(
        os.environ.get("MAX_ACTIVE_POSE_JOBS_PER_USER", "2")
    ):
        raise HTTPException(
            status_code=429,
            detail={
                "code": "user_capacity_reached",
                "message": "Too many active jobs for this user.",
            },
        )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": AGENT_MODEL}


@app.get("/api/templates", response_model=list[TemplateMeta])
def list_templates(_user_id: str = Depends(require_auth)) -> list[TemplateMeta]:
    return TEMPLATES


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
    except Exception as exc:  # noqa: BLE001
        logger.exception("Guidance agent failed")
        add_credits(
            user_id,
            amount=CONFIG.guidance_cost,
            event_type="guidance_refund",
            metadata={"reason": "provider_error"},
        )
        raise HTTPException(status_code=502, detail=f"agent error: {exc}") from exc
    return result.output


@app.post("/api/pose-mask", response_model=PoseMaskResponse)
async def extract_pose_mask(req: PoseMaskRequest) -> PoseMaskResponse:
    try:
        mask_url, width, height = await _llm_extract_pose_mask(req.image_url)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Pose mask extraction failed")
        raise HTTPException(
            status_code=502, detail=f"mask extraction failed: {exc}"
        ) from exc
    return PoseMaskResponse(mask_url=mask_url, width=width, height=height, source="llm")


@dataclass
class PoseJobState:
    job: PoseVariantJob
    reference_image_data_url: str
    events: asyncio.Queue[str] = field(default_factory=asyncio.Queue)


def _pick_template(slot_index: int) -> TemplateMeta:
    return TEMPLATES[slot_index % len(TEMPLATES)]


def _make_variation_prompt(template: TemplateMeta, slot_index: int, tier: str) -> str:
    tier_style = (
        "fast preview render, keep composition simple but realistic"
        if tier == "fast"
        else "high quality portrait photo look, detailed skin tones, natural lighting"
    )
    return (
        "Generate a realistic selfie-style portrait of the same person from the reference photo.\n"
        "Preserve face identity, skin tone, hair, and overall likeness from the reference.\n"
        "Do not stylize as cartoon/illustration; avoid blur, artifacts, and distorted anatomy.\n"
        f"Pose: {template.name}. Description: {template.description}.\n"
        f"Style hint: {tier_style}.\n"
        f"Variation seed: {slot_index + 1}.\n"
        "Framing: upper body, portrait orientation, social-media ready, natural expression."
    )


def _event_payload(
    kind: str, job: PoseVariantJob, result: PoseVariantResult | None = None
) -> str:
    payload: dict[str, object] = {"type": kind, "job": job.model_dump()}
    if result:
        payload["result"] = result.model_dump()
    return f"data: {json.dumps(payload)}\n\n"


async def _push_event(
    job_id: str, kind: str, result: PoseVariantResult | None = None
) -> None:
    async with _jobs_lock:
        state = _pose_jobs.get(job_id)
        if not state:
            return
        await state.events.put(_event_payload(kind, state.job, result))


async def _store_image(b64_or_url: str, job_id: str, slot_index: int) -> str:
    if b64_or_url.startswith("http://") or b64_or_url.startswith("https://"):
        return b64_or_url
    raw_b64 = (
        b64_or_url.split(",", 1)[1] if b64_or_url.startswith("data:") else b64_or_url
    )
    binary = base64.b64decode(raw_b64)
    file_name = f"{job_id}-{slot_index + 1}.png"
    out_path = generated_dir / file_name
    out_path.write_bytes(binary)
    return f"/generated/{file_name}"


async def _openrouter_generate_to_job(
    prompt: str,
    model: str,
    job_id: str,
    slot_index: int,
    reference_image_data_url: str | None = None,
) -> str:
    async def as_public_url(value: str) -> str:
        if value.startswith("http://") or value.startswith("https://"):
            return value
        return await _store_image(value, job_id, slot_index)

    if not OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY is not set")
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    message_content: str | list[dict[str, object]]
    if reference_image_data_url:
        message_content = [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": reference_image_data_url}},
        ]
    else:
        message_content = prompt

    payload = {
        "model": model,
        "modalities": ["image"],
        "messages": [{"role": "user", "content": message_content}],
    }
    timeout = httpx.Timeout(45.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        res = await client.post(
            f"{OPENROUTER_BASE_URL}/chat/completions", headers=headers, json=payload
        )
        if res.status_code >= 400:
            raise RuntimeError(
                f"OpenRouter error ({res.status_code}) for model {model}: {res.text}"
            )
        body = res.json()

    # OpenRouter image responses may vary by upstream model/provider shape.
    data = body.get("data") or []
    if data:
        first = data[0]
        b64 = first.get("b64_json")
        if b64:
            return await _store_image(b64, job_id, slot_index)
        url = first.get("url") or first.get("image_url")
        if isinstance(url, str):
            return await as_public_url(url)

    images = body.get("images") or []
    if images:
        first = images[0]
        b64 = first.get("b64_json")
        if b64:
            return await _store_image(b64, job_id, slot_index)
        image_url = first.get("image_url") or first.get("url")
        if isinstance(image_url, str):
            return await as_public_url(image_url)
        if isinstance(image_url, dict) and isinstance(image_url.get("url"), str):
            return await as_public_url(image_url["url"])

    choices = body.get("choices") or []
    if choices:
        message = choices[0].get("message") or {}
        message_images = message.get("images") or []
        if message_images:
            first = message_images[0]
            b64 = first.get("b64_json")
            if b64:
                return await _store_image(b64, job_id, slot_index)
            image_url = first.get("image_url") or first.get("url")
            if isinstance(image_url, str):
                return await as_public_url(image_url)
            if isinstance(image_url, dict) and isinstance(image_url.get("url"), str):
                return await as_public_url(image_url["url"])

        content = message.get("content")
        if isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "image_url":
                    image_url = part.get("image_url")
                    if isinstance(image_url, str):
                        return await as_public_url(image_url)
                    if isinstance(image_url, dict) and isinstance(
                        image_url.get("url"), str
                    ):
                        return await as_public_url(image_url["url"])
                if part.get("type") == "image_base64" and isinstance(
                    part.get("data"), str
                ):
                    return await _store_image(part["data"], job_id, slot_index)

    raise RuntimeError(f"Unsupported image response shape from OpenRouter: {body}")


async def _run_slot(job_id: str, slot_index: int, tier: str) -> None:
    template = _pick_template(slot_index)
    prompt = _make_variation_prompt(template, slot_index, tier=tier)
    model = FAST_IMAGE_MODEL if tier == "fast" else HQ_IMAGE_MODEL
    async with _jobs_lock:
        state = _pose_jobs.get(job_id)
        reference_image_data_url = state.reference_image_data_url if state else None

    try:
        image_url = await _openrouter_generate_to_job(
            prompt,
            model=model,
            job_id=job_id,
            slot_index=slot_index,
            reference_image_data_url=reference_image_data_url,
        )
    except Exception:
        if tier == "hq":
            fallback_tier = "fast"
            fallback_model = FAST_IMAGE_MODEL
            fallback_prompt = _make_variation_prompt(template, slot_index, tier="fast")
            image_url = await _openrouter_generate_to_job(
                fallback_prompt,
                model=fallback_model,
                job_id=job_id,
                slot_index=slot_index,
                reference_image_data_url=reference_image_data_url,
            )
            tier = fallback_tier
            model = fallback_model
        else:
            raise

    async with _jobs_lock:
        state = _pose_jobs.get(job_id)
        if not state:
            return
        result = PoseVariantResult(
            id=f"{job_id}-{slot_index + 1:02d}",
            slot_index=slot_index,
            title=template.name,
            instruction=template.description,
            image_url=image_url,
            pose_template_id=template.id,
            replaceable=True,
            tier=tier,
            model=model,
        )
        state.job.results.append(result)
        state.job.results.sort(key=lambda r: r.slot_index)
        state.job.progress = len(state.job.results)
        if state.job.progress >= state.job.total:
            state.job.status = "ready"
        else:
            state.job.status = "generating"
    await _push_event(job_id, "image_ready", result)


async def _run_pose_job(job_id: str) -> None:
    # 3 fast + 3 HQ, with small backend concurrency.
    slot_plan = [(i, "fast") for i in range(3)] + [(i, "hq") for i in range(3, 6)]
    semaphore = asyncio.Semaphore(3)

    async def run_with_limit(slot_index: int, tier: str) -> None:
        async with semaphore:
            await _run_slot(job_id, slot_index, tier)

    tasks = [
        asyncio.create_task(run_with_limit(slot_index, tier))
        for slot_index, tier in slot_plan
    ]
    failures = 0
    for task in tasks:
        try:
            await task
        except Exception as exc:  # noqa: BLE001
            logger.exception("Pose slot failed", exc_info=exc)
            failures += 1

    user_id = _pose_job_owners.get(job_id)
    async with _jobs_lock:
        state = _pose_jobs.get(job_id)
        if not state:
            return
        if failures and state.job.progress == 0:
            state.job.status = "failed"
            state.job.error = "All image generations failed."
            if user_id:
                credit_refund_for_failed_job(user_id, job_id)
        elif state.job.progress < state.job.total:
            state.job.status = "ready"
        else:
            state.job.status = "ready"
    await _push_event(job_id, "job_done")


@app.post("/api/pose-variants", response_model=PoseVariantJob)
async def create_pose_variants(
    request: Request,
    reference_image: UploadFile = File(...),
    user_id: str = Depends(require_auth),
) -> PoseVariantJob:
    # Validate file is an image
    allowed_mime_types = {"image/jpeg", "image/png", "image/webp"}
    mime = reference_image.content_type or "image/jpeg"
    if mime not in allowed_mime_types:
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Only JPEG, PNG, and WebP images are supported.",
        )

    allowed_extensions = {".jpg", ".jpeg", ".png", ".webp"}
    filename = reference_image.filename or ""
    suffix = Path(filename).suffix.lower()
    if suffix not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail="Invalid file extension. Only .jpg, .jpeg, .png, and .webp files are supported.",
        )

    _enforce_pose_job_limits(user_id, request)

    image_bytes = await reference_image.read()
    reference_image_data_url = (
        f"data:{mime};base64,{base64.b64encode(image_bytes).decode('ascii')}"
    )
    job_id = uuid4().hex
    job = PoseVariantJob(
        job_id=job_id,
        status="queued",
        progress=0,
        total=POSE_VARIANT_TOTAL,
        results=[],
        error=None,
    )
    async with _jobs_lock:
        _pose_jobs[job_id] = PoseJobState(
            job=job, reference_image_data_url=reference_image_data_url
        )
    _pose_job_owners[job_id] = user_id
    try:
        spend_credits(
            user_id,
            amount=CONFIG.pose_variant_cost,
            event_type="pose_variant_job",
            event_ref=job_id,
        )
    except HTTPException:
        async with _jobs_lock:
            _pose_jobs.pop(job_id, None)
        _pose_job_owners.pop(job_id, None)
        raise
    asyncio.create_task(_run_pose_job(job_id))
    return job


@app.get("/api/pose-variants/{job_id}", response_model=PoseVariantJob)
async def get_pose_variants_job(
    job_id: str, user_id: str = Depends(require_auth)
) -> PoseVariantJob:
    async with _jobs_lock:
        state = _pose_jobs.get(job_id)
        if not state:
            raise HTTPException(status_code=404, detail="Job not found")
        owner = _pose_job_owners.get(job_id)
        if owner is not None and owner != user_id:
            raise HTTPException(status_code=404, detail="Job not found")
        return state.job


@app.get("/api/pose-variants/{job_id}/events")
async def stream_pose_variants_events(job_id: str) -> StreamingResponse:
    async with _jobs_lock:
        state = _pose_jobs.get(job_id)
        if not state:
            raise HTTPException(status_code=404, detail="Job not found")
        initial = _event_payload("snapshot", state.job)

    async def event_stream() -> AsyncIterator[str]:
        yield initial
        while True:
            async with _jobs_lock:
                state_now = _pose_jobs.get(job_id)
                if not state_now:
                    break
                is_done = state_now.job.status in {"ready", "failed"}
            if is_done and state_now and state_now.events.empty():
                break
            try:
                # Keep this below typical proxy idle limits (~10s) so the SSE
                # stream stays open through ngrok and similar tunnels.
                message = await asyncio.wait_for(state_now.events.get(), timeout=8.0)
                yield message
            except TimeoutError:
                yield ": keepalive\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


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


@app.post("/api/memory/onboarding/images", response_model=MemoryStatusResponse)
async def seed_memory_onboarding_images(
    images: list[UploadFile] = File(...),
    allow_camera_roll: bool = Form(default=True),
    user_id: str = Depends(require_auth),
) -> MemoryStatusResponse:
    if not images:
        raise HTTPException(status_code=400, detail="at least one image is required")
    if len(images) > MAX_ONBOARDING_IMAGES:
        raise HTTPException(
            status_code=400,
            detail=f"too many images (max {MAX_ONBOARDING_IMAGES})",
        )

    prepared: list[OnboardingImageInput] = []
    for upload in images:
        content_type = (upload.content_type or "").lower().strip()
        if content_type not in {"image/jpeg", "image/png", "image/webp"}:
            raise HTTPException(
                status_code=400,
                detail="only JPEG, PNG, and WebP images are supported",
            )
        raw = await upload.read()
        if len(raw) > MAX_ONBOARDING_IMAGE_BYTES:
            raise HTTPException(
                status_code=400,
                detail=f"image too large: {upload.filename or 'unknown'}",
            )
        prepared.append(
            OnboardingImageInput(
                filename=(upload.filename or "upload").strip()[:120],
                content_type=content_type,
                data=raw,
            )
        )

    memory = get_mubit_memory()
    if not memory:
        return MemoryStatusResponse(ok=False)

    memory.remember_preferences(
        user_id=user_id,
        allow_camera_roll=allow_camera_roll,
        allow_instagram=False,
        allow_pinterest=False,
    )
    entries = extract_memory_seed_entries(prepared)
    if not entries:
        logger.warning("No onboarding entries extracted for user=%s", user_id)
        return MemoryStatusResponse(ok=False)
    memory.remember_onboarding_seed(
        user_id=user_id,
        entries=[entry.model_dump() for entry in entries],
    )
    logger.info(
        "Onboarding seed stored for user=%s selected=%d extracted=%d",
        user_id,
        len(prepared),
        len(entries),
    )
    return MemoryStatusResponse(ok=True)


@app.post("/api/memory/preferences", response_model=MemoryStatusResponse)
def set_memory_preferences(
    payload: MemoryPreferencesRequest,
    user_id: str = Depends(require_auth),
) -> MemoryStatusResponse:
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
    memory = get_mubit_memory()
    if not memory:
        return MemoryStatusResponse(ok=False)
    memory.reset_user_memory(user_id=user_id, hard_reset=payload.hard_reset)
    return MemoryStatusResponse(ok=True)
