#!/usr/bin/env bash
set -euo pipefail

echo "Stopping backend (port 8000), frontend (port 5173), and ngrok..."

kill_by_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)"
  if [[ -n "$pids" ]]; then
    kill $pids
  fi
}

kill_by_port 8000
kill_by_port 5173
pkill -f "ngrok http" 2>/dev/null || true

echo "Done."
