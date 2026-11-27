#!/usr/bin/env bash
# Start the migration session: a fresh Claude Code session with the migration guard loaded.
# Usage: scripts/start-migration-session.sh [feature]   (default: timesheet)
set -euo pipefail
cd "$(dirname "$0")/.."
feature="${1:-timesheet}"

# Claude Code keeps per-project memory under ~/.claude/projects/<encoded path>/memory. Rather
# than predict the encoding, refuse if any project folder named after this checkout has memory.
shopt -s nullglob
for memory in "$HOME"/.claude/projects/*"$(basename "$PWD")"*/memory; do
  if [ -n "$(ls -A "$memory")" ]; then
    echo "refusing: project memory is not empty, the session would not start fresh: $memory" >&2
    exit 1
  fi
done

exec claude --settings .claude/migration-settings.json --permission-mode default \
  "Use the migrate-feature skill to migrate the $feature feature."
