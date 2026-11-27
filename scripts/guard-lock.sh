#!/usr/bin/env bash
# OS-level write protection for the migration session: scripts/guard-lock.sh lock|unlock|status
# lock: remove write permission from the trust base (the agent's own folders stay writable).
# unlock: restore it, e.g. so the human can edit harness/triage.yaml between stops.
set -euo pipefail
cd "$(dirname "$0")/.."
# The guard's write-protected paths, plus the builder-only folders and the git hooks.
PATHS=()
while IFS= read -r p; do PATHS+=("$p"); done < <(jq -r '.writePaths[]' .claude/hooks/guard-patterns.json)
PATHS+=(docs audit vitest.private.config.ts .git/hooks)
case "${1:-}" in
  lock) chmod -R a-w "${PATHS[@]}" ;;
  unlock) chmod -R u+w "${PATHS[@]}" ;;
  status) for p in "${PATHS[@]}"; do [ -w "$p" ] && echo "writable  $p" || echo "read-only $p"; done ;;
  *) echo "usage: $0 lock|unlock|status" >&2; exit 2 ;;
esac
