#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/frontend"

echo "Starting frontend on http://localhost:5173"
if command -v bun >/dev/null 2>&1; then
  bun run dev --host 0.0.0.0 --port 5173
else
  npm run dev -- --host 0.0.0.0 --port 5173
fi
