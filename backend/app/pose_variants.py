"""Async local job runner for OpenAI pose-variant image edits."""

from __future__ import annotations

import base64
import logging
import os
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Literal, cast
from uuid import uuid4

from fastapi import UploadFile
from openai import OpenAI

from .schemas import PoseVariantJob, PoseVariantResult
from .storage import delete_prefix, s3_enabled, upload_bytes

logger = logging.getLogger(__name__)

GENERATED_ROOT = Path(
    os.environ.get(
        "GENERATED_IMAGE_DIR",
        str(Path(__file__).resolve().parents[1] / "generated"),
    )
)
GENERATED_TTL_SECONDS = int(os.environ.get("GENERATED_TTL_SECONDS", str(6 * 60 * 60)))
IMAGE_MODEL = os.environ.get("IMAGE_MODEL", "gpt-image-1")
IMAGE_SIZE = cast(
    Literal["256x256", "512x512", "1024x1024", "1536x1024", "1024x1536", "auto"],
    os.environ.get("IMAGE_SIZE", "1024x1536"),
)
IMAGE_QUALITY = cast(
    Literal["standard", "low", "medium", "high", "auto"],
    os.environ.get("IMAGE_QUALITY", "medium"),
)
IMAGE_INPUT_FIDELITY = cast(
    Literal["high", "low"],
    os.environ.get("IMAGE_INPUT_FIDELITY", "high"),
)

SYSTEM_PROMPT = """\
You are a pose-variation image generation assistant for a mobile camera coaching app.

Generate a realistic pose-variant photo of the same person from the reference image.
Preserve identity, clothing, body proportions, scene mood, lighting continuity, and a
semantically similar background. Change only the body pose requested below.

Hard constraints:
- Photorealistic mobile portrait image.
- Clean anatomy, natural limbs and hands.
- One person only unless the source image contains more.
- No text overlays, logos, watermarks, UI, borders, frames, or collage layouts.
- Keep the subject centered and visible enough for pose guidance.
- Favor identity preservation over pose exaggeration.
"""


@dataclass(frozen=True)
class PoseVariantSpec:
    id: str
    title: str
    instruction: str
    pose_template_id: str
    prompt: str


POSE_VARIANTS: tuple[PoseVariantSpec, ...] = (
    PoseVariantSpec(
        id="pose-01",
        title="Crossed arms",
        instruction="Cross your arms and square your shoulders.",
        pose_template_id="pose-01",
        prompt="Pose with arms crossed across the chest, shoulders squared, confident neutral expression.",
    ),
    PoseVariantSpec(
        id="pose-02",
        title="Relaxed turn",
        instruction="Turn your body slightly and relax both arms.",
        pose_template_id="pose-02",
        prompt="Turn the torso slightly away from camera with both arms relaxed, natural selfie framing.",
    ),
    PoseVariantSpec(
        id="pose-03",
        title="Thoughtful",
        instruction="Bring one hand up near your chin.",
        pose_template_id="pose-03",
        prompt="Thoughtful pose with one hand resting near the chin and the other arm relaxed or folded.",
    ),
    PoseVariantSpec(
        id="pose-04",
        title="Look away",
        instruction="Turn your head slightly to the side.",
        pose_template_id="pose-04",
        prompt="Subtle side-looking pose, head turned slightly away while the torso remains selfie-friendly.",
    ),
    PoseVariantSpec(
        id="pose-05",
        title="Hands forward",
        instruction="Bring both hands forward and keep shoulders level.",
        pose_template_id="pose-05",
        prompt="Bring both hands forward near the lower frame, shoulders level, composed portrait posture.",
    ),
    PoseVariantSpec(
        id="pose-06",
        title="Angled cross",
        instruction="Angle your body, then cross your arms.",
        pose_template_id="pose-06",
        prompt="Slightly angled body with arms crossed, confident mobile portrait composition.",
    ),
    PoseVariantSpec(
        id="pose-07",
        title="Hand on cheek",
        instruction="Lift one hand near your cheek.",
        pose_template_id="pose-03",
        prompt="One hand lightly near the cheek or jaw, relaxed shoulders, natural facial expression.",
    ),
    PoseVariantSpec(
        id="pose-08",
        title="Over shoulder",
        instruction="Turn your shoulders and look back to camera.",
        pose_template_id="pose-04",
        prompt="Shoulders turned slightly with face still mostly visible, looking back toward camera.",
    ),
    PoseVariantSpec(
        id="pose-09",
        title="Lean in",
        instruction="Lean slightly toward the camera.",
        pose_template_id="pose-02",
        prompt="Lean slightly toward camera with relaxed arms and friendly mobile selfie framing.",
    ),
    PoseVariantSpec(
        id="pose-10",
        title="Calm profile",
        instruction="Angle your body and keep your face mostly visible.",
        pose_template_id="pose-06",
        prompt="Calm three-quarter profile pose, body angled, face mostly visible, natural hands.",
    ),
)

_jobs: dict[str, PoseVariantJob] = {}
_job_dirs: dict[str, Path] = {}
_job_personalization: dict[str, str] = {}
_job_timestamps: dict[str, float] = {}
_lock = Lock()


def _now() -> float:
    return time.time()


def _safe_error(exc: Exception) -> str:
    message = str(exc).strip()
    if not message:
        return exc.__class__.__name__
    return message[:500]


def _update_job(job_id: str, **updates: object) -> None:
    with _lock:
        current = _jobs[job_id]
        _jobs[job_id] = current.model_copy(update=updates)


def cleanup_old_jobs() -> None:
    GENERATED_ROOT.mkdir(parents=True, exist_ok=True)
    cutoff = _now() - GENERATED_TTL_SECONDS

    with _lock:
        expired = [
            job_id
            for job_id, job in _jobs.items()
            if _job_timestamps.get(job_id, 0) < cutoff
        ]

    for job_id in expired:
        path = _job_dirs.get(job_id)
        if path:
            shutil.rmtree(path, ignore_errors=True)
        if s3_enabled():
            try:
                delete_prefix(f"{job_id}/")
            except Exception:  # noqa: BLE001
                logger.warning("Failed to clean S3 prefix for job %s", job_id)
        with _lock:
            _jobs.pop(job_id, None)
            _job_dirs.pop(job_id, None)
            _job_personalization.pop(job_id, None)
            _job_timestamps.pop(job_id, None)


async def create_pose_variant_job(reference_image: UploadFile) -> PoseVariantJob:
    cleanup_old_jobs()

    job_id = uuid4().hex
    job_dir = GENERATED_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=False)

    suffix = Path(reference_image.filename or "reference.jpg").suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
        suffix = ".jpg"
    reference_path = job_dir / f"reference{suffix}"

    with reference_path.open("wb") as out:
        while chunk := await reference_image.read(1024 * 1024):
            out.write(chunk)

    job = PoseVariantJob(
        job_id=job_id,
        status="queued",
        progress=0,
        total=len(POSE_VARIANTS),
        results=[],
    )
    with _lock:
        _jobs[job_id] = job
        _job_dirs[job_id] = job_dir
        _job_timestamps[job_id] = _now()
    return job


def set_pose_variant_personalization(job_id: str, personalization: str) -> None:
    if not personalization.strip():
        return
    with _lock:
        _job_personalization[job_id] = personalization.strip()[:1200]


def get_pose_variant_job(job_id: str) -> PoseVariantJob | None:
    cleanup_old_jobs()
    with _lock:
        return _jobs.get(job_id)


def _prompt_for_pose(spec: PoseVariantSpec) -> str:
    return (
        f"{SYSTEM_PROMPT}\n\n"
        f"Target pose: {spec.prompt}\n"
        "Output one clean portrait image only. Do not include captions, labels, "
        "numbered panels, borders, UI elements, logos, or watermarks."
    )


def _prompt_for_pose_with_personalization(
    spec: PoseVariantSpec, personalization: str
) -> str:
    if not personalization:
        return _prompt_for_pose(spec)
    return (
        f"{_prompt_for_pose(spec)}\n\n"
        "User taste preferences for this generation:\n"
        f"{personalization}\n\n"
        "Apply these preferences where compatible with good pose coaching."
    )


def run_pose_variant_job(job_id: str) -> None:
    job_dir = _job_dirs[job_id]
    reference_path = next(job_dir.glob("reference.*"))
    client = OpenAI()
    results: list[PoseVariantResult] = []
    personalization = _job_personalization.get(job_id, "")

    _update_job(job_id, status="generating", progress=0, error=None)

    try:
        for index, spec in enumerate(POSE_VARIANTS, start=1):
            with reference_path.open("rb") as image_file:
                response = client.images.edit(
                    model=IMAGE_MODEL,
                    image=image_file,
                    prompt=_prompt_for_pose_with_personalization(spec, personalization),
                    size=IMAGE_SIZE,
                    quality=IMAGE_QUALITY,
                    input_fidelity=IMAGE_INPUT_FIDELITY,
                    output_format="jpeg",
                )

            if not response.data or not response.data[0].b64_json:
                raise RuntimeError(f"No image returned for {spec.id}")

            image_bytes = base64.b64decode(response.data[0].b64_json)
            filename = f"{spec.id}.jpg"

            if s3_enabled():
                s3_key = f"{job_id}/{filename}"
                image_url = upload_bytes(image_bytes, s3_key)
            else:
                (job_dir / filename).write_bytes(image_bytes)
                image_url = f"/generated/{job_id}/{filename}"

            results.append(
                PoseVariantResult(
                    id=spec.id,
                    slot_index=index - 1,
                    title=spec.title,
                    instruction=spec.instruction,
                    image_url=image_url,
                    pose_template_id=spec.pose_template_id,
                    replaceable=False,
                    tier="fast",
                    model=IMAGE_MODEL,
                )
            )
            _update_job(job_id, progress=index, results=results.copy())

        _update_job(
            job_id, status="ready", progress=len(POSE_VARIANTS), results=results
        )
    except Exception as exc:  # noqa: BLE001 - generation provider failures are surfaced as job errors
        logger.exception("Pose variant job failed: %s", job_id)
        _update_job(job_id, status="failed", error=_safe_error(exc), results=results)


def reorder_pose_variants(order: list[str]) -> None:
    """Reorder tuple globally for next generation request if needed."""
    if not order:
        return
    rank = {pose_id: idx for idx, pose_id in enumerate(order)}
    sorted_variants = sorted(
        POSE_VARIANTS,
        key=lambda spec: rank.get(spec.id, len(rank) + 100),
    )
    globals()["POSE_VARIANTS"] = tuple(sorted_variants)
