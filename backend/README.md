# frame-mog — backend (uv + FastAPI + Pydantic-AI)

See the repo root [`README.md`](../README.md) for product context and
architecture. This document covers backend specifics.

## Install

```bash
uv sync
```

## Run the API

```bash
cp .env.example .env      # AI_PROVIDER=mock works out of the box
uv run uvicorn app.main:app --reload
```

Endpoints:

- `GET  /health` — `{ "status": "ok", "provider": "<name>" }`
- `GET  /api/templates` — list of `TemplateMeta`
- `POST /api/guidance` — request body is a `PoseContext`, response is a
  validated `GuidanceResponse`.

## Providers

The active guidance agent is selected by `AI_PROVIDER`:

| value    | implementation              | requires          |
|----------|-----------------------------|-------------------|
| `mock`   | `app.agents.mock.MockAgent` | nothing           |
| `openai` | `app.agents.pydantic_ai_agent.PydanticAIAgent` | `OPENAI_API_KEY` |

The OpenAI provider uses Pydantic-AI with `output_type=GuidanceResponse`,
so the model is forced to return a schema-valid object. `AGENT_MODEL`
(default `openai:gpt-4o-mini`) can be any Pydantic-AI-supported model
string. Any unexpected failure at request time is caught and the server
falls back to the mock agent so the frontend never sees an error.

## Tests

```bash
uv run pytest -q
```
