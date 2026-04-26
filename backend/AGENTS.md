# AGENTS.md — backend (FastAPI + Pydantic AI)

Instructions for AI agents working in the `backend/` directory.

## Stack

- **Python 3.11+** with **uv** as the package manager.
- **FastAPI** for the HTTP layer.
- **Pydantic AI** (slim, OpenAI provider) for the guidance agent.
- **Pydantic v2** for all request/response schemas.
- **Clerk** (`clerk-backend-api`) for JWT authentication.
- **Mubit SDK** for user taste-memory persistence.

## Key files

```
app/
├── main.py            # FastAPI app, routes, Pydantic AI agent setup
├── schemas.py         # All Pydantic models (Landmark, PoseContext, GuidanceResponse, …)
├── templates.py       # Predefined pose template metadata (TEMPLATES list)
├── auth.py            # require_auth dependency — Clerk JWT verification
├── routes/pose_variants.py  # POST /api/pose-variants — SSE stream (image + outline per pose)
└── mubit_memory.py    # Mubit SDK integration for user memory
tests/
├── __init__.py
└── test_templates.py  # Smoke tests (health, templates, pose-variants, memory)
```

## Commands

```sh
# Run from the backend/ directory

# Install / sync dependencies
uv sync

# Run the dev server
uv run uvicorn app.main:app --reload

# Run tests
uv run pytest -q

# Lint (single file)
uvx ruff check app/main.py

# Lint (all)
uvx ruff check .

# Format check
uvx ruff format --check .

# Type check
uvx ty check .
```

## Code conventions

### Python style

- Always start files with `from __future__ import annotations`.
- Use type hints on every function signature and variable where non-obvious.
- Use `list[X]`, `dict[K, V]`, `str | None` (PEP 604) — not `List`, `Dict`, `Optional`.
- Import order: `__future__` → stdlib → third-party → local (`from .module`).
- Ruff handles formatting and linting — do not configure Black or isort separately.

### Schemas

- All request/response models live in `schemas.py`.
- Use `Field(...)` with validation constraints (`ge`, `le`, `min_length`, `max_length`).
- Document models and fields with docstrings, not inline comments.

### Routes

- Every API route must use `Depends(require_auth)` — no unauthenticated endpoints
  (except `/health`).
- Return typed Pydantic models via `response_model=...` on route decorators.
- Use `async def` for routes that `await` anything; plain `def` is fine for
  synchronous endpoints.

### Agent

- The Pydantic AI agent is lazily instantiated via `get_agent()` (cached with
  `@lru_cache`). This keeps imports and tests fast.
- The system prompt lives in `SYSTEM_PROMPT` at module level — keep it short and
  structured.
- Model is configured via `AGENT_MODEL` (default `meta-llama/llama-3.3-70b-instruct`) and `POSE_GUIDE_MODEL` (default `openai/gpt-4o-mini`); FLUX only applies to `FAST_IMAGE_MODEL` image generation.

### Error handling

- Catch broad exceptions from the LLM provider and surface them as `HTTPException(502)`.
- Use `logger.exception(...)` for unexpected errors — never silently swallow them.

## Testing

- Framework: **pytest** with `FastAPI.TestClient`.
- Auth bypass: tests override the `require_auth` dependency with
  `lambda: "test-user-id"` — see the `_bypass_auth` fixture in `test_templates.py`.
- Always clean up overrides in fixture teardown (`app.dependency_overrides.pop(...)`).
- Test new endpoints by following the existing pattern: create a `TestClient`,
  call the endpoint, assert status code and response shape.

### Running a single test

```sh
uv run pytest tests/test_templates.py::test_health_endpoint -v
```

## Do

- Add new schemas to `schemas.py`, not inline in route files.
- Add new template metadata to `templates.py` (the `TEMPLATES` list).
- Write a test for every new endpoint.
- Keep the agent prompt under 200 words — it runs on every guidance request.

## Don't

- Don't process raw images/video in routes — the backend only receives landmarks.
- Don't import heavy ML libraries (MediaPipe, OpenCV, etc.) — pose detection is
  frontend-only.
- Don't skip `require_auth` on new endpoints.
- Don't add `# type: ignore` or `Any` — fix the types instead.
- Don't modify `uv.lock` manually — use `uv add <package>` or `uv sync`.
- Don't hard-code API keys or secrets — always read from `os.environ`.
