#!/usr/bin/env bash
# Starts the tutor on http://localhost:5173 (backend on :8787). Ctrl+C stops both.
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$ROOT/.env" ]; then
  echo "Missing .env — copy .env.example to .env and put your API key in it." >&2
  exit 1
fi
command -v uv >/dev/null || { echo "Please install uv: https://docs.astral.sh/uv/" >&2; exit 1; }
command -v pnpm >/dev/null || { echo "Please install pnpm: npm i -g pnpm" >&2; exit 1; }

[ -d "$ROOT/frontend/node_modules" ] || (cd "$ROOT/frontend" && pnpm install)

cleanup() { kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(cd "$ROOT/backend" && uv run uvicorn app.main:app --port 8787 --reload --reload-dir app) &
BACKEND_PID=$!
(cd "$ROOT/frontend" && pnpm dev) &
FRONTEND_PID=$!

echo ""
echo "  Tutor:  http://localhost:5173"
echo "  Admin login: see ADMIN_USERNAME / ADMIN_PASSWORD in .env (default admin / admin123)"
echo ""
wait
