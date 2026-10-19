#!/usr/bin/env bash
# Publishes the code to the PUBLIC repository WITHOUT the copyrighted textbook / teacher's-guide text.
# The private repository (git remote "origin") keeps everything. This works on a temporary copy:
# it removes the book text from every commit, checks nothing is left, and force-pushes that copy.
#
#   ./scripts/publish_public.sh
#
# Uses GITHUB_PUBLIC_TOKEN if set, otherwise the token of the GitHub MCP server in ~/.cursor/mcp.json.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC_URL="https://github.com/fromStepan/vibe_coded_socraticAI.git"
EXCLUDE="backend/content backend/books/grade-5-guide.md"

TOKEN="${GITHUB_PUBLIC_TOKEN:-$(python3 -c 'import json, os
cfg = json.load(open(os.path.expanduser("~/.cursor/mcp.json")))
print(cfg["mcpServers"]["github"]["headers"]["Authorization"].split()[-1])')}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git clone -q --no-local "$ROOT" "$TMP/repo"
cd "$TMP/repo"

FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --prune-empty \
  --index-filter "git rm -r -q --cached --ignore-unmatch $EXCLUDE" HEAD >/dev/null

mkdir -p backend/content
cp "$ROOT/scripts/public-content-README.md" backend/content/README.md
git add backend/content/README.md
git -c user.name="$(git -C "$ROOT" config user.name)" -c user.email="$(git -C "$ROOT" config user.email)" \
  commit -q -m "Note: textbook content is not included in the public repository"

if git log HEAD --name-only --format= | grep -qE '^backend/content/grade-|grade-5-guide\.md'; then
  echo "Textbook text is still in the history — NOT publishing." >&2
  exit 1
fi

AUTH="$(printf 'x-access-token:%s' "$TOKEN" | base64 | tr -d '\n')"
git -c http.extraHeader="Authorization: Basic $AUTH" push -q --force "$PUBLIC_URL" HEAD:main
echo "Published $(git rev-list --count HEAD) commits to https://github.com/fromStepan/vibe_coded_socraticAI (without textbook text)."
