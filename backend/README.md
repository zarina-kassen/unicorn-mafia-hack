# frame-mog — backend (FastAPI + Pydantic AI Gateway)

See the repo root [`README.md`](../README.md) for product context and
architecture. This file covers backend specifics.

## Install

```bash
uv sync
```

## Run

```bash
cp .env.example .env
# set PYDANTIC_AI_GATEWAY_API_KEY=pylf_v... (get one at logfire.pydantic.dev)
# set OPENAI_API_KEY=sk-... for pose-variant image generation
uv run uvicorn app.main:app --reload
```

Endpoints:

- `GET  /health` — `{ "status": "ok", "model": "<agent_model>" }`
- `GET  /api/templates` — list of `TemplateMeta`
- `POST /api/guidance` — `PoseContext` → `GuidanceResponse`
- `POST /api/pose-variants` — multipart `reference_image` → async job
- `GET  /api/pose-variants/{job_id}` — poll generated pose gallery status
- `POST /api/memory/onboarding/images` — multipart `images` (1–5) + taste extraction → Mubit seed
- `POST /api/memory/preferences` — persist per-source learning preferences
- `POST /api/memory/reset` — soft/hard user memory reset request
- `GET  /generated/...` — temporary local generated image files

## Model

The agent uses [Pydantic AI](https://ai.pydantic.dev/) with
`output_type=GuidanceResponse`, so the model is forced to return a
schema-valid object. The default model string is
`gateway/openai:gpt-5.3` — requests are routed through the
[Pydantic AI Gateway](https://pydantic.dev/docs/ai/overview/gateway/),
authenticated with `PYDANTIC_AI_GATEWAY_API_KEY`. Override `AGENT_MODEL`
in `.env` to swap to any other gateway-supported model.

## Pose Variant Generation

Pose variants use OpenAI image editing with `gpt-image-1` by default. The
frontend captures one live camera frame, uploads it as `reference_image`,
then polls until the backend returns 10 generated gallery cards. Generated
files are stored locally under `backend/generated/` and cleaned up by TTL.

Useful environment overrides:

```bash
IMAGE_MODEL=gpt-image-1
IMAGE_SIZE=1024x1536
IMAGE_QUALITY=medium
IMAGE_INPUT_FIDELITY=high
GENERATED_TTL_SECONDS=21600
MUBIT_API_KEY=mbt_...
MUBIT_ENDPOINT=https://api.mubit.ai
MUBIT_TRANSPORT=auto
ONBOARDING_VISION_MODEL=gpt-4.1-mini
```

### Mubit personalization

When `MUBIT_API_KEY` is set:

- `/api/memory/onboarding/images` stores extracted taste tags from user-selected photos.
- `/api/memory/preferences` and `/api/memory/reset` update the user’s memory policy.

`OPENAI_API_KEY` is required for onboarding image analysis. If Mubit or OpenAI is unavailable,
memory endpoints return `ok: false` while the rest of the API keeps working.

## Tests

```bash
uv run pytest -q
```
