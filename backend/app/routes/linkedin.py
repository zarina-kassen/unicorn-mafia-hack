"""LinkedIn OAuth, OpenRouter vision pipeline, Devin sequencing, and UGC publish."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import RedirectResponse

from ..auth.clerk import require_auth
from ..linkedin_publish import (
    build_authorize_url,
    exchange_code_for_tokens,
    fetch_linkedin_sub,
    linkedin_demo_mode,
    publish_ugc_image_carousel,
)
from ..linkedin_scoring import ScoredPhoto
from ..linkedin_store import (
    create_oauth_state,
    get_linkedin_tokens,
    get_saved_photo,
    take_oauth_state,
    upsert_linkedin_tokens,
)
from ..linkedin_workflow import run_pipeline, save_uploaded_photos
from ..mubit_memory import get_mubit_memory
from ..schemas import (
    LinkedInConnectionStatus,
    LinkedInOAuthStartResponse,
    LinkedInPipelineResponse,
    LinkedInPublishRequest,
    LinkedInPublishResponse,
    ScoredPhotoPublic,
    SequencedPhotoPublic,
    VisionDimensionPublic,
)

logger = logging.getLogger(__name__)

# Same directory as `main` StaticFiles: backend/generated (app/routes/ -> ../.. = backend)
GENERATED_DIR = Path(__file__).resolve().parent.parent.parent / "generated"
router = APIRouter(prefix="/api/linkedin", tags=["linkedin"])


def _scored_to_public(sc: ScoredPhoto) -> ScoredPhotoPublic:
    d = sc.dimensions
    return ScoredPhotoPublic(
        photo_id=sc.photo_id,
        dimensions=VisionDimensionPublic(
            composition=d.composition,
            pose_quality=d.pose_quality,
            lighting=d.lighting,
            expression=d.expression,
            average=sc.average,
        ),
    )


@router.get("/status", response_model=LinkedInConnectionStatus)
def linkedin_status(user_id: str = Depends(require_auth)) -> LinkedInConnectionStatus:
    if linkedin_demo_mode():
        return LinkedInConnectionStatus(connected=True)
    return LinkedInConnectionStatus(connected=get_linkedin_tokens(user_id) is not None)


@router.get("/oauth/authorize", response_model=LinkedInOAuthStartResponse)
def linkedin_oauth_start(
    user_id: str = Depends(require_auth),
) -> LinkedInOAuthStartResponse:
    st = create_oauth_state(clerk_user_id=user_id)
    if linkedin_demo_mode():
        upsert_linkedin_tokens(
            clerk_user_id=user_id,
            access_token="demo-linkedin-access",
            refresh_token="demo-refresh",
            expires_in_seconds=3600,
            linkedin_member_id="demoMember",
        )
        base = os.environ.get(
            "FRONTEND_OAUTH_LANDING", "http://localhost:5173/"
        ).rstrip("/")
        return LinkedInOAuthStartResponse(
            authorization_url=f"{base}/?linkedin=ok=1", state=st
        )
    url = build_authorize_url(state=st)
    return LinkedInOAuthStartResponse(authorization_url=url, state=st)


@router.get("/oauth/callback")
async def linkedin_oauth_callback(
    code: str,
    state: str,
    error: str | None = None,
) -> RedirectResponse:
    if error or not code or not state:
        base = os.environ.get("FRONTEND_OAUTH_LANDING", "http://localhost:5173/")
        return RedirectResponse(
            f"{base.rstrip('/')}/?linkedin=error=1", status_code=302
        )
    user_id = take_oauth_state(state)
    if not user_id:
        base = os.environ.get("FRONTEND_OAUTH_LANDING", "http://localhost:5173/")
        return RedirectResponse(
            f"{base.rstrip('/')}/?linkedin=error=state", status_code=302
        )
    if linkedin_demo_mode():
        upsert_linkedin_tokens(
            clerk_user_id=user_id,
            access_token="demo-linkedin-access",
            refresh_token="demo-refresh",
            expires_in_seconds=3600,
            linkedin_member_id="demoMember",
        )
    else:
        try:
            tok = await exchange_code_for_tokens(code=code)
        except Exception as err:  # noqa: BLE001
            logger.exception("LinkedIn token exchange failed: %s", err)
            base = os.environ.get("FRONTEND_OAUTH_LANDING", "http://localhost:5173/")
            return RedirectResponse(
                f"{base.rstrip('/')}/?linkedin=error=token", status_code=302
            )
        at = tok.get("access_token")
        if not isinstance(at, str):
            base = os.environ.get("FRONTEND_OAUTH_LANDING", "http://localhost:5173/")
            return RedirectResponse(
                f"{base.rstrip('/')}/?linkedin=error=token", status_code=302
            )
        exp = (
            int(tok.get("expires_in", 3600))
            if tok.get("expires_in") is not None
            else 3600
        )
        rt = tok.get("refresh_token")
        rts = str(rt) if isinstance(rt, str) else None
        sub: str | None = None
        try:
            sub = await fetch_linkedin_sub(access_token=at)
        except Exception:  # noqa: BLE001
            logger.exception("userinfo")
        upsert_linkedin_tokens(
            clerk_user_id=user_id,
            access_token=at,
            refresh_token=rts,
            expires_in_seconds=exp,
            linkedin_member_id=sub,
        )
    base = os.environ.get("FRONTEND_OAUTH_LANDING", "http://localhost:5173/")
    return RedirectResponse(f"{base.rstrip('/')}/?linkedin=ok=1", status_code=302)


@router.post("/pipeline", response_model=LinkedInPipelineResponse)
async def linkedin_run_pipeline(
    user_id: str = Depends(require_auth),
    metas: str = Form("[]"),
    images: list[UploadFile] = File(...),
) -> LinkedInPipelineResponse:
    if not images:
        raise HTTPException(status_code=400, detail="at least one image is required")
    try:
        raw_metas: object = json.loads(metas)
    except json.JSONDecodeError as err:
        raise HTTPException(status_code=400, detail="metas must be valid JSON") from err
    if not isinstance(raw_metas, list):
        raise HTTPException(
            status_code=400, detail="metas must be a JSON array of objects"
        )
    metas_list = [m for m in raw_metas if isinstance(m, dict)]
    blobs: list[bytes] = []
    cts: list[str] = []
    for f in images[:20]:
        raw = await f.read()
        blobs.append(raw)
        cts.append((f.content_type or "image/jpeg").lower())
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    rows = save_uploaded_photos(
        clerk_user_id=user_id,
        base_dir=GENERATED_DIR,
        metas=metas_list,
        image_blobs=blobs,
        content_types=cts,
    )
    if not rows:
        raise HTTPException(
            status_code=400, detail="could not persist any uploaded image"
        )
    result = await run_pipeline(user_id=user_id, base_dir=GENERATED_DIR, photos=rows)
    scored: list[ScoredPhoto] = result["scored_all"]
    top: list[ScoredPhoto] = result["top_six"]
    seq = result["sequence"]
    mubit_ctx: str = result["mubit_context"]

    seq_public: list[SequencedPhotoPublic] = []
    for it in seq:
        row = get_saved_photo(user_id, it.photo_id)
        cid_raw = (row.extra.get("client_id") if row else None) or None
        client_id: str | None = (
            str(cid_raw) if isinstance(cid_raw, str) and cid_raw else None
        )
        seq_public.append(
            SequencedPhotoPublic(
                photo_id=it.photo_id,
                order_index=it.order_index,
                reason=it.reason,
                client_id=client_id,
            )
        )
    return LinkedInPipelineResponse(
        mubit_context=mubit_ctx,
        photos_scored=[_scored_to_public(s) for s in scored],
        top_six=[_scored_to_public(s) for s in top],
        sequence=seq_public,
        stored_photo_ids=[r.id for r in rows],
    )


@router.post("/publish", response_model=LinkedInPublishResponse)
async def linkedin_publish_endpoint(
    payload: LinkedInPublishRequest,
    user_id: str = Depends(require_auth),
) -> LinkedInPublishResponse:
    seen: set[str] = set()
    paths: list[Path] = []
    for pid in payload.ordered_photo_ids:
        if pid in seen:
            raise HTTPException(
                status_code=400, detail="duplicate id in ordered_photo_ids"
            )
        seen.add(pid)
        row = get_saved_photo(user_id, pid)
        if not row:
            raise HTTPException(status_code=404, detail=f"photo {pid} not found")
        paths.append(GENERATED_DIR / row.image_relpath)
    mubit = get_mubit_memory()
    remember_payload: dict[str, object] = {
        "event": "linkedin_published" if not payload.as_draft else "linkedin_draft",
        "ordered": [s.model_dump() for s in (payload.sequence or [])],
        "ordered_ids": list(payload.ordered_photo_ids),
        "as_draft": payload.as_draft,
    }
    try:
        post_urn = await publish_ugc_image_carousel(
            user_id=user_id,
            image_paths=paths,
            as_draft=payload.as_draft,
        )
    except Exception as err:  # noqa: BLE001
        logger.exception("LinkedIn publish failed: %s", err)
        raise HTTPException(status_code=502, detail=str(err)) from err
    if mubit:
        mubit.remember_linkedin_post(user_id=user_id, payload=remember_payload)
    return LinkedInPublishResponse(
        post_urn=post_urn,
        demo=linkedin_demo_mode(),
    )
