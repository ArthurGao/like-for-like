#!/usr/bin/env bash
# OS-level write protection for the migration session: scripts/guard-lock.sh lock|unlock|status
# lock: remove write permission from the trust base (the agent's own folders stay writable).
# unlock: restore it, e.g. so the human can edit harness/triage.yaml between stops.
set -euo pipefail
cd "$(dirname "$0")/.."
PATHS=(harness legacy platform scripts .claude
  package.json package-lock.json tsconfig.json vitest.config.ts vitest.private.config.ts
  docker-compose.yml CLAUDE.md docs audit .git/hooks)
case "${1:-}" in
  lock) chmod -R a-w "${PATHS[@]}" ;;
  unlock) chmod -R u+w "${PATHS[@]}" ;;
  status) for p in "${PATHS[@]}"; do [ -w "$p" ] && echo "writable  $p" || echo "read-only $p"; done ;;
  *) echo "usage: $0 lock|unlock|status" >&2; exit 2 ;;
esac
