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
uv run uvicorn app.main:app --reload
```

Endpoints:

- `GET  /health` — `{ "status": "ok", "model": "<agent_model>" }`
- `GET  /api/templates` — list of `TemplateMeta`
- `POST /api/guidance` — `PoseContext` → `GuidanceResponse`

## Model

The agent uses [Pydantic AI](https://ai.pydantic.dev/) with
`output_type=GuidanceResponse`, so the model is forced to return a
schema-valid object. The default model string is
`gateway/openai:gpt-5.3` — requests are routed through the
[Pydantic AI Gateway](https://pydantic.dev/docs/ai/overview/gateway/),
authenticated with `PYDANTIC_AI_GATEWAY_API_KEY`. Override `AGENT_MODEL`
in `.env` to swap to any other gateway-supported model.

## Tests

```bash
uv run pytest -q
```
