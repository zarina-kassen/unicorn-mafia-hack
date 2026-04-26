#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-5173}"

if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok is not installed. Install it first: https://ngrok.com/download"
  exit 1
fi

echo "Starting ngrok tunnel for http://localhost:${PORT}"
ngrok http "${PORT}"
