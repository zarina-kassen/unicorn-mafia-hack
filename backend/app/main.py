"""FastAPI entrypoint for the frame-mog backend."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import AsyncIterator
from uuid import uuid4

from dotenv import load_dotenv
import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic_ai import Agent

from .schemas import (
    GuidanceResponse,
    Landmark,
    PoseContext,
    PoseVariantJob,
    PoseVariantResult,
    TemplateMeta,
)
from .templates import TEMPLATES

load_dotenv(override=True)

logger = logging.getLogger(__name__)

AGENT_MODEL = os.environ.get("AGENT_MODEL", "gateway/openai:gpt-5.3")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = os.environ.get(
    "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"
)
FAST_IMAGE_MODEL = os.environ.get("FAST_IMAGE_MODEL", "black-forest-labs/flux-schnell")
HQ_IMAGE_MODEL = os.environ.get("HQ_IMAGE_MODEL", "openai/gpt-image-1")
POSE_VARIANT_TOTAL = 6

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


@lru_cache(maxsize=1)
def get_agent():  # type: ignore[no-untyped-def]
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
_jobs_lock = asyncio.Lock()
_pose_jobs: dict[str, "PoseJobState"] = {}

generated_dir = Path(__file__).resolve().parent.parent / "generated"
generated_dir.mkdir(parents=True, exist_ok=True)
app.mount("/generated", StaticFiles(directory=generated_dir), name="generated")

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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": AGENT_MODEL}


@app.get("/api/templates", response_model=list[TemplateMeta])
def list_templates() -> list[TemplateMeta]:
    return TEMPLATES


@app.post("/api/guidance", response_model=GuidanceResponse)
async def guidance(ctx: PoseContext) -> GuidanceResponse:
    try:
        result = await get_agent().run(_render_prompt(ctx))
    except Exception as exc:  # noqa: BLE001 — surface all provider errors uniformly
        logger.exception("Guidance agent failed")
        raise HTTPException(status_code=502, detail=f"agent error: {exc}") from exc
    return result.output


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

    async with _jobs_lock:
        state = _pose_jobs.get(job_id)
        if not state:
            return
        if failures and state.job.progress == 0:
            state.job.status = "failed"
            state.job.error = "All image generations failed."
        elif state.job.progress < state.job.total:
            state.job.status = "ready"
        else:
            state.job.status = "ready"
    await _push_event(job_id, "job_done")


@app.post("/api/pose-variants", response_model=PoseVariantJob)
async def create_pose_variants(
    reference_image: UploadFile = File(...),
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
    asyncio.create_task(_run_pose_job(job_id))
    return job


@app.get("/api/pose-variants/{job_id}", response_model=PoseVariantJob)
async def get_pose_variants_job(job_id: str) -> PoseVariantJob:
    async with _jobs_lock:
        state = _pose_jobs.get(job_id)
        if not state:
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
