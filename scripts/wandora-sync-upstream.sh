#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_NAME="upstream"
UPSTREAM_URL="https://github.com/melgarafael/DeskcommCRM.git"

if git remote get-url "$UPSTREAM_NAME" >/dev/null 2>&1; then
  git remote set-url "$UPSTREAM_NAME" "$UPSTREAM_URL"
else
  git remote add "$UPSTREAM_NAME" "$UPSTREAM_URL"
fi

echo "Fetching DeskcommCRM upstream..."
git fetch "$UPSTREAM_NAME" --prune --tags

echo
echo "Upstream configured:"
git remote -v | grep -E '^(origin|upstream)[[:space:]]' || true

echo
echo "No merge was performed."
echo "Review upstream/main and merge/cherry-pick into a dedicated branch before changing Elus main."
