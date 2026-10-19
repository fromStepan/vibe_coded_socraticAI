#!/usr/bin/env bash
# Opens the tutor to phones and other computers through a temporary Cloudflare https link.
# Works while this Mac is on and this window stays open; Ctrl+C closes the link.
# The link is new every time you run this.
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v cloudflared >/dev/null || { echo "Please install cloudflared: brew install cloudflared" >&2; exit 1; }

echo "Building the app…"
(cd "$ROOT/frontend" && pnpm build >/dev/null)

PIDS=()
cleanup() { kill "${PIDS[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

if curl -s http://127.0.0.1:8787/api/health >/dev/null; then
  # The backend from ./start.sh is running: reload it so it serves the fresh build.
  touch "$ROOT/backend/app/main.py"
else
  (cd "$ROOT/backend" && uv run uvicorn app.main:app --port 8787 >/dev/null 2>&1) &
  PIDS+=($!)
fi
for _ in $(seq 1 30); do curl -s http://127.0.0.1:8787/ | grep -q '<div id="root">' && break; sleep 1; done

caffeinate -dims &   # keep the Mac awake while the link is open
PIDS+=($!)

echo "Opening the public link…"
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8787 2>&1 | while IFS= read -r line; do
  if url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' <<<"$line")"; then
    echo ""
    echo "  ┌──────────────────────────────────────────────────────────────┐"
    echo "    Open on any device:  $url"
    echo "  └──────────────────────────────────────────────────────────────┘"
    echo "  Keep this window open. Ctrl+C closes the link."
    echo ""
  fi
done
