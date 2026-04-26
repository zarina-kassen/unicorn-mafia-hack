# AGENTS.md — frame-mog

Instructions for AI coding agents working on this repository.

## Project overview

Real-time photo-posing coach. The browser captures a webcam feed, runs
MediaPipe pose detection locally, and an LLM backend provides natural-language
coaching to help the user match a target pose template.

```
frontend/   React 19 + Vite + TypeScript (bun)
backend/    FastAPI + Pydantic AI (uv / Python 3.11+)
```

Auth is handled by **Clerk** (`@clerk/react` on the frontend,
`clerk-backend-api` on the backend).

## Monorepo layout

```
.
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI entrypoint, Pydantic AI agent
│   │   ├── schemas.py       # Shared Pydantic models
│   │   ├── templates.py     # Predefined pose template metadata
│   │   ├── auth.py          # Clerk JWT verification dependency
│   │   ├── pose_variants.py # Async pose-variant generation jobs
│   │   └── mubit_memory.py  # User taste-memory via Mubit SDK
│   ├── tests/
│   │   └── test_templates.py
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── App.tsx           # Main application & state coordinator
│   │   ├── main.tsx          # React root with Clerk + React Query providers
│   │   ├── pose/             # MediaPipe integration, template matching
│   │   ├── overlay/          # Canvas-based skeletal rendering
│   │   ├── camera/           # Webcam hook (useCamera)
│   │   ├── backend/          # Throttled API client for guidance
│   │   ├── api/              # Typed API client & types
│   │   └── hooks/            # Custom React hooks (useGuidance)
│   ├── package.json
│   └── vite.config.ts
└── .github/workflows/ci.yml  # CI: lint + test (backend), lint + build (frontend)
```

## Environment setup

### Prerequisites

| Tool   | Version | Install                                       |
|--------|---------|-----------------------------------------------|
| Python | 3.11+   | system / pyenv                                |
| uv     | latest  | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| bun    | latest  | `curl -fsSL https://bun.sh/install \| bash`    |

### Install dependencies

```sh
cd backend  && uv sync
cd ../frontend && bun install
```

### Run locally

```sh
# Terminal 1 — backend (port 8000)
cd backend && uv run uvicorn app.main:app --reload

# Terminal 2 — frontend (port 5173, proxies /api to backend)
cd frontend && bun run dev
```

### Environment variables

| Variable                     | Where    | Purpose                          |
|------------------------------|----------|----------------------------------|
| `CLERK_SECRET_KEY`           | backend  | Clerk JWT verification           |
| `CLERK_AUTHORIZED_PARTIES`   | backend  | Comma-separated allowed origins  |
| `VITE_CLERK_PUBLISHABLE_KEY` | frontend | Clerk frontend key               |
| `VITE_BACKEND_URL`           | frontend | Backend base URL (empty for proxy)|
| `AGENT_MODEL`                | backend  | OpenRouter LLM slug (default `openai/gpt-5.4-mini`) |

## Commands

```sh
# Backend
cd backend && uv run pytest -q                # run tests
cd backend && uvx ruff check .                 # lint
cd backend && uvx ruff format --check .        # format check
cd backend && uvx ty check .                   # type check

# Frontend
cd frontend && bun run lint                    # ESLint
cd frontend && bun run build                   # TypeScript + Vite build
cd frontend && bun run dev                     # dev server
```

## CI pipeline

GitHub Actions runs on every push / PR to `main`:

| Job               | What it checks              |
|-------------------|-----------------------------|
| Backend · Lint    | `ruff check`, `ruff format --check`, `ty check` |
| Backend · Test    | `pytest -q`                 |
| Frontend · Lint   | `bun run lint` (ESLint)     |
| Frontend · Build  | `tsc -b && vite build`      |

All four jobs must pass before merging.

## Code style

### Do

- Use type hints everywhere (Python and TypeScript strict mode).
- Follow existing import ordering: stdlib → third-party → local.
- Use Pydantic `BaseModel` for all API schemas.
- Use `Field(...)` with constraints (`ge`, `le`, `min_length`, etc.) on schema fields.
- Use `from __future__ import annotations` at the top of every Python file.
- Use functional React components with hooks — no class components.
- Prefix custom hooks with `use`.
- Use `import type` for type-only imports in TypeScript.

### Don't

- Don't add new dependencies without justification.
- Don't use `Any`, `# type: ignore`, or `@ts-ignore`.
- Don't hard-code secrets or credentials — use environment variables.
- Don't modify generated files (`bun.lock`, `uv.lock`) manually.
- Don't bypass Clerk auth — every new API endpoint must use `Depends(require_auth)`.
- Don't send raw video frames to the backend — only landmarks and metadata.

## Testing

- **Backend**: pytest with `FastAPI.TestClient`. Auth is bypassed in tests via
  `app.dependency_overrides[require_auth]` (see `tests/test_templates.py`).
- **Frontend**: no test runner configured yet. Verify with `bun run build`
  (includes TypeScript type checking).
- Write tests for new backend endpoints. Follow the existing pattern in
  `test_templates.py`.

## Architecture constraints

- MediaPipe runs **in the browser only** — never on the backend.
- The backend agent receives pre-extracted landmarks, not images/frames.
- The frontend throttles backend calls to ~1.5 s intervals and aborts stale
  requests — the overlay must never block on the network.
- Pose templates are a fixed library. The agent picks a template and provides
  guidance; it does not generate outline coordinates.

## PR guidelines

- Branch from `main`. Keep diffs small and focused.
- Run lint + tests locally before pushing.
- Title format: `type: short description` (e.g., `feat: add new pose template`).
- All CI checks must pass before merge.
