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
# set OPENROUTER_API_KEY=... (pose-variant images + pose-outline JSON via OpenRouter SDK)
# set MUBIT_API_KEY=... (required — the API will not start without it)
# set OPENAI_API_KEY=sk-... only if you use onboarding vision (`/api/memory/onboarding/images`)
uv run uvicorn app.main:app --reload
```

Endpoints:

- `GET  /health` — `{ "status": "ok", "model": "<agent_model>" }`
- `GET  /api/templates` — list of `TemplateMeta`
- `POST /api/guidance` — `PoseContext` → `GuidanceResponse`
- `POST /api/pose-variants` — multipart `reference_image` → **SSE** (`text/event-stream`): `target_count`, per-item `pose` (variant + outline polygon), optional `pose_error`, terminal `error` / `done`
- `POST /api/memory/onboarding/images` — multipart `images` (1–5) + taste extraction → Mubit seed
- `POST /api/memory/preferences` — persist per-source learning preferences
- `POST /api/memory/reset` — soft/hard user memory reset request
- `GET  /generated/...` — temporary local generated image files

## Model

The pose-target agent uses [Pydantic AI](https://ai.pydantic.dev/) with
structured output, calling OpenRouter’s OpenAI-compatible API (`OPENROUTER_API_KEY`).
Default `AGENT_MODEL` is `meta-llama/llama-3.3-70b-instruct` (text pose planner — not FLUX). Portraits use
`FAST_IMAGE_MODEL` (FLUX). Override in `.env` for any OpenRouter chat model.

## Pose Variant Generation (SSE)

One request runs the full pipeline: **pose targets** (Pydantic AI) → **N parallel** OpenRouter
image generations (`FAST_IMAGE_MODEL`, FLUX on OpenRouter) → for each stored image, a **vision** outline (`POSE_GUIDE_MODEL`,
default `openai/gpt-4o-mini`) with JSON Schema structured output (16–28 normalized
`{x,y}` vertices). Each completed item is pushed on the stream as a `pose` event
(`{ "pose": PoseVariantResult, "outline": PoseOutlineResponse }`).

Useful environment overrides:

```bash
OPENROUTER_API_KEY=...
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
FAST_IMAGE_MODEL=black-forest-labs/flux.2-klein-4b
POSE_GUIDE_MODEL=openai/gpt-4o-mini
POSE_GUIDE_MAX_TOKENS=2048
AGENT_MAX_TOKENS=8192
GENERATED_TTL_SECONDS=21600
MUBIT_API_KEY=mbt_...
MUBIT_ENDPOINT=https://api.mubit.ai
MUBIT_TRANSPORT=auto
ONBOARDING_VISION_MODEL=gpt-4.1-mini
```

### Mubit personalization

`MUBIT_API_KEY` is **required**: `validate_config()` runs on startup and the process exits if it is
missing or blank. Memory routes assume Mubit is configured.

- `/api/memory/onboarding/images` stores extracted taste tags from user-selected photos.
- `/api/memory/preferences` and `/api/memory/reset` update the user’s memory policy.

Onboarding image analysis (`memory_onboarding.py`) calls the **OpenAI API** with `OPENAI_API_KEY`,
not OpenRouter. If the OpenAI call fails for a given image, that extraction is skipped; Mubit
writes still require a working Mubit service for successful onboarding seeds.

## Tests

```bash
uv run pytest -q
```
