"""FastAPI entrypoint for the frame-mog backend."""

from __future__ import annotations

import logging
import os
from functools import lru_cache

from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic_ai import Agent

from .auth import require_auth
from .pose_variants import (
    GENERATED_ROOT,
    create_pose_variant_job,
    get_pose_variant_job,
    run_pose_variant_job,
)
from .schemas import (
    GuidanceResponse,
    Landmark,
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
def get_agent() -> Agent[None, GuidanceResponse]:
    """Build the Pydantic AI agent on first use.

    Lazy so importing this module doesn't require a gateway key — handy for
    tests and for the /api/templates endpoint which doesn't touch the model.
    """
    return Agent(  # ty: ignore[invalid-return-type]
        AGENT_MODEL,
        output_type=GuidanceResponse,
        system_prompt=SYSTEM_PROMPT,
    )


app = FastAPI(title="frame-mog")
GENERATED_ROOT.mkdir(parents=True, exist_ok=True)
app.mount("/generated", StaticFiles(directory=GENERATED_ROOT), name="generated")

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


@app.post("/api/guidance", response_model=GuidanceResponse)
async def guidance(
    ctx: PoseContext, _user_id: str = Depends(require_auth)
) -> GuidanceResponse:
    try:
        result = await get_agent().run(_render_prompt(ctx))
    except Exception as exc:  # noqa: BLE001 — surface all provider errors uniformly
        logger.exception("Guidance agent failed")
        raise HTTPException(status_code=502, detail=f"agent error: {exc}") from exc
    return result.output


@app.post("/api/pose-variants", response_model=PoseVariantJob)
async def create_pose_variants(
    background_tasks: BackgroundTasks,
    reference_image: UploadFile = File(...),
) -> PoseVariantJob:
    if not reference_image.content_type or not reference_image.content_type.startswith(
        "image/"
    ):
        raise HTTPException(status_code=400, detail="reference_image must be an image")

    job = await create_pose_variant_job(reference_image)
    background_tasks.add_task(run_pose_variant_job, job.job_id)
    return job


@app.get("/api/pose-variants/{job_id}", response_model=PoseVariantJob)
def get_pose_variants(job_id: str) -> PoseVariantJob:
    job = get_pose_variant_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="pose variant job not found")
    return job
