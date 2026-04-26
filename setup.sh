#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "==> Backend: uv sync"
( cd "$ROOT/backend" && uv sync )

echo "==> Backend: init SQLite (billing + linkedin stores)"
( cd "$ROOT/backend" && uv run python -c "from app.billing import init_billing_store; from app.linkedin_store import init_linkedin_store; init_billing_store(); init_linkedin_store(); print('OK')" )

echo "==> Frontend: bun install"
( cd "$ROOT/frontend" && bun install )

echo "==> Full setup done. Copy backend/.env.example to backend/.env and set keys as needed."
echo "    Run backend:  cd backend && uv run uvicorn app.main:app --reload"
echo "    Run frontend: cd frontend && bun run dev"
