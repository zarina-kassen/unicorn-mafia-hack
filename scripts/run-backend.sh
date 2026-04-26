#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/backend"

if [[ -f .env ]]; then
  # Export all variables declared in backend/.env for this process.
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
else
  echo "Warning: backend/.env not found. Starting without local env overrides."
fi

echo "Starting backend on http://localhost:8000"
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
