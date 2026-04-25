"""Async local job runner for OpenAI pose-variant image edits."""

from __future__ import annotations

import base64
import logging
import os
import shutil
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, cast
from pathlib import Path
from threading import Lock
from uuid import uuid4

from fastapi import UploadFile
from openai import OpenAI

from .schemas import PoseVariantJob, PoseVariantResult, PoseVariantSceneContext

logger = logging.getLogger(__name__)

ImageEditSize = Literal[
    "256x256", "512x512", "1024x1024", "1536x1024", "1024x1536", "auto"
]
ImageEditQuality = Literal["standard", "low", "medium", "high", "auto"]
ImageInputFidelity = Literal["high", "low"]


def _coerce_image_size(raw: str) -> ImageEditSize:
    allowed: set[ImageEditSize] = {
        "256x256",
        "512x512",
        "1024x1024",
        "1536x1024",
        "1024x1536",
        "auto",
    }
    return cast(ImageEditSize, raw) if raw in allowed else "1024x1536"


def _coerce_image_quality(raw: str) -> ImageEditQuality:
    allowed: set[ImageEditQuality] = {
        "standard",
        "low",
        "medium",
        "high",
        "auto",
    }
    return cast(ImageEditQuality, raw) if raw in allowed else "medium"


def _coerce_input_fidelity(raw: str) -> ImageInputFidelity:
    return cast(ImageInputFidelity, raw) if raw in ("high", "low") else "high"


GENERATED_ROOT = Path(
    os.environ.get(
        "GENERATED_IMAGE_DIR",
        str(Path(__file__).resolve().parents[1] / "generated"),
    )
)
GENERATED_TTL_SECONDS = int(os.environ.get("GENERATED_TTL_SECONDS", str(6 * 60 * 60)))
IMAGE_MODEL = os.environ.get("IMAGE_MODEL", "gpt-image-1")
IMAGE_SIZE = _coerce_image_size(os.environ.get("IMAGE_SIZE", "1024x1536"))
IMAGE_QUALITY = _coerce_image_quality(os.environ.get("IMAGE_QUALITY", "medium"))
IMAGE_INPUT_FIDELITY = _coerce_input_fidelity(
    os.environ.get("IMAGE_INPUT_FIDELITY", "high")
)

SYSTEM_PROMPT = """\
You edit a live phone-camera frame for a pose coach: lock scene and subject first, change pose second.

(1) Lock: same person—face, skin, hair, expression character, and clothing; no beautify, no face swap, no
different person. Keep the same real room: wall/furniture/window layout, visible objects, and scene colors.
Keep the same color temperature and lighting *character* (no relighting, no "studio" or golden-hour look).
Keep the same camera: distance, crop, and head size in frame—this is a fixed viewpoint, not a new portrait
session.

(2) Change only: body pose, limbs, and hands to match the target line below, with clean natural anatomy.
Prefer subtle pose over breaking (1).

Never: swap to a studio, plain backdrop, or synthetic set; add fake bokeh, heavy blur, or haze; add,
remove, or move room elements; add extra people. No text, logos, watermarks, or UI. One person unless
the source shows more.
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
        prompt="Turn the torso slightly away from camera with both arms relaxed, same camera distance and crop as the reference.",
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
        prompt="Subtle side-looking pose, head turned slightly away, torso still suitable for a front-camera guide.",
    ),
    PoseVariantSpec(
        id="pose-05",
        title="Hands forward",
        instruction="Bring both hands forward and keep shoulders level.",
        pose_template_id="pose-05",
        prompt="Bring both hands forward near the lower frame, shoulders level, composed upright posture.",
    ),
    PoseVariantSpec(
        id="pose-06",
        title="Angled cross",
        instruction="Angle your body, then cross your arms.",
        pose_template_id="pose-06",
        prompt="Slightly angled body with arms crossed, confident, same room and framing as the reference.",
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
        prompt="Lean slightly toward camera with relaxed arms; keep the same field of view and head size as the reference.",
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
_job_scene_context: dict[str, PoseVariantSceneContext] = {}
_job_owner: dict[str, str] = {}
_lock = Lock()

# gpt-image-1 supported sizes; map capture width/height to closest output aspect.
_ALLOWED_IMAGE_SIZES: tuple[tuple[ImageEditSize, float], ...] = (
    ("1024x1024", 1.0),
    ("1024x1536", 1024 / 1536),
    ("1536x1024", 1536 / 1024),
)


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
            for job_id, path in _job_dirs.items()
            if path.exists() and path.stat().st_mtime < cutoff
        ]

    for job_id in expired:
        path = _job_dirs.get(job_id)
        if path:
            shutil.rmtree(path, ignore_errors=True)
        with _lock:
            _jobs.pop(job_id, None)
            _job_dirs.pop(job_id, None)
            _job_personalization.pop(job_id, None)
            _job_scene_context.pop(job_id, None)
            _job_owner.pop(job_id, None)


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
    )
    with _lock:
        _jobs[job_id] = job
        _job_dirs[job_id] = job_dir
    return job


def set_pose_variant_personalization(job_id: str, personalization: str) -> None:
    if not personalization.strip():
        return
    with _lock:
        _job_personalization[job_id] = personalization.strip()[:1200]


def set_pose_variant_scene_context(
    job_id: str, context: PoseVariantSceneContext
) -> None:
    with _lock:
        _job_scene_context[job_id] = context


def set_pose_variant_owner(job_id: str, user_id: str) -> None:
    with _lock:
        _job_owner[job_id] = user_id


def cancel_pose_variant_job(job_id: str) -> None:
    """Remove a queued job and its directory (e.g. when credit debit fails after create)."""
    with _lock:
        path = _job_dirs.pop(job_id, None)
        _jobs.pop(job_id, None)
        _job_personalization.pop(job_id, None)
        _job_scene_context.pop(job_id, None)
        _job_owner.pop(job_id, None)
    if path and path.exists():
        shutil.rmtree(path, ignore_errors=True)


def count_active_pose_jobs() -> int:
    with _lock:
        return sum(
            1 for job in _jobs.values() if job.status in {"queued", "generating"}
        )


def count_user_active_pose_jobs(user_id: str) -> int:
    with _lock:
        return sum(
            1
            for job_id, job in _jobs.items()
            if _job_owner.get(job_id) == user_id
            and job.status in {"queued", "generating"}
        )


def get_pose_variant_job(job_id: str) -> PoseVariantJob | None:
    cleanup_old_jobs()
    with _lock:
        return _jobs.get(job_id)


def get_pose_variant_job_owner(job_id: str) -> str | None:
    """Clerk user id that started the job, if recorded."""
    with _lock:
        return _job_owner.get(job_id)


def pick_image_size_for_aspect_ratio(aspect_ratio: float) -> ImageEditSize:
    """Map capture width/height to the closest allowed gpt-image-1 output size string."""
    allowed_names = {name for name, _ in _ALLOWED_IMAGE_SIZES}
    default: ImageEditSize = (
        IMAGE_SIZE if IMAGE_SIZE in allowed_names else _ALLOWED_IMAGE_SIZES[1][0]
    )
    best: ImageEditSize = default
    best_diff = float("inf")
    for name, r in _ALLOWED_IMAGE_SIZES:
        d = abs(aspect_ratio - r)
        if d < best_diff:
            best_diff = d
            best = name
    return best


def build_scene_prompt_fragment(context: PoseVariantSceneContext | None) -> str:
    """Deterministic text block appended to the edit prompt; used in tests and generation."""
    if context is None:
        return ""
    lines: list[str] = [
        "Client framing metadata (obey in addition to the instructions above):",
        f"- Source capture: {context.capture_width}×{context.capture_height}px; aspect (w/h) ≈ {context.aspect_ratio:.4f}.",
    ]
    if (
        context.subject_fill_width is not None
        and context.subject_fill_height is not None
    ):
        pw = int(round(100 * context.subject_fill_width))
        ph = int(round(100 * context.subject_fill_height))
        lines.append(
            f"- Subject occupies roughly {pw}% of frame width and {ph}% of frame height; "
            f"placement: {context.horizontal_placement} in the reference image (left = smaller x)."
        )
    elif context.horizontal_placement != "unknown":
        lines.append(
            f"- Subject placement: {context.horizontal_placement} in the reference image (left = smaller x)."
        )
    lines.append(f"- Framing hint: {context.framing_label}.")
    if context.subject_bbox is not None:
        b = context.subject_bbox
        lines.append(
            f"- Normalized body bounds: x from {b.x_min:.3f} to {b.x_max:.3f}, "
            f"y from {b.y_min:.3f} to {b.y_max:.3f}."
        )
    lines.append(
        "- Match this scale and position; do not reframe to a tighter crop or a new setup."
    )
    return "\n".join(lines)


def _prompt_for_pose(spec: PoseVariantSpec, *, scene_block: str = "") -> str:
    body = SYSTEM_PROMPT
    if scene_block:
        body = f"{body}\n\n{scene_block}"
    return (
        f"{body}\n\n"
        f"Target pose: {spec.prompt}\n"
        "Output one photoreal full frame matching the source room and scale. No captions, labels, "
        "numbered panels, borders, UI, logos, or watermarks."
    )


def _prompt_for_pose_with_personalization(
    spec: PoseVariantSpec, personalization: str, *, scene_block: str = ""
) -> str:
    if not personalization:
        return _prompt_for_pose(spec, scene_block=scene_block)
    return (
        f"{_prompt_for_pose(spec, scene_block=scene_block)}\n\n"
        "User taste preferences for this generation:\n"
        f"{personalization}\n\n"
        "Apply these preferences where compatible with good pose coaching."
    )


def run_pose_variant_job(
    job_id: str,
    *,
    on_failed: Callable[[str], None] | None = None,
    timeout_seconds: int = 180,
) -> None:
    job_dir = _job_dirs[job_id]
    reference_path = next(job_dir.glob("reference.*"))
    client = OpenAI()
    results: list[PoseVariantResult] = []
    personalization = _job_personalization.get(job_id, "")
    scene = _job_scene_context.get(job_id)
    scene_block = build_scene_prompt_fragment(scene)
    image_size = (
        pick_image_size_for_aspect_ratio(scene.aspect_ratio)
        if scene is not None
        else IMAGE_SIZE
    )
    started_at = _now()

    _update_job(job_id, status="generating", progress=0, error=None)

    try:
        for index, spec in enumerate(POSE_VARIANTS, start=1):
            if _now() - started_at > timeout_seconds:
                raise TimeoutError(
                    f"Pose generation exceeded {timeout_seconds}s timeout"
                )
            with reference_path.open("rb") as image_file:
                response = client.images.edit(
                    model=IMAGE_MODEL,
                    image=image_file,
                    prompt=_prompt_for_pose_with_personalization(
                        spec, personalization, scene_block=scene_block
                    ),
                    size=image_size,
                    quality=IMAGE_QUALITY,
                    input_fidelity=IMAGE_INPUT_FIDELITY,
                    output_format="jpeg",
                )

            if not response.data or not response.data[0].b64_json:
                raise RuntimeError(f"No image returned for {spec.id}")

            image_bytes = base64.b64decode(response.data[0].b64_json)
            filename = f"{spec.id}.jpg"
            (job_dir / filename).write_bytes(image_bytes)

            results.append(
                PoseVariantResult(
                    id=spec.id,
                    title=spec.title,
                    instruction=spec.instruction,
                    image_url=f"/generated/{job_id}/{filename}",
                    pose_template_id=spec.pose_template_id,
                    replaceable=False,
                )
            )
            _update_job(job_id, progress=index, results=results.copy())

        _update_job(
            job_id, status="ready", progress=len(POSE_VARIANTS), results=results
        )
    except Exception as exc:  # noqa: BLE001 - generation provider failures are surfaced as job errors
        logger.exception("Pose variant job failed: %s", job_id)
        _update_job(job_id, status="failed", error=_safe_error(exc), results=results)
        if on_failed is not None:
            try:
                on_failed(job_id)
            except Exception:  # noqa: BLE001
                logger.exception("Failed to handle refund callback for job: %s", job_id)


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
