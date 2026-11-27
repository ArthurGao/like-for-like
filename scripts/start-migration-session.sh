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

prompt="Use the migrate-feature skill to migrate the $feature feature. You have my go-ahead to make the commits the skill asks for."
settings=(--settings .claude/migration-settings.json --permission-mode default)

# The trust base is read-only for the length of the session (scripts/guard-lock.sh).
scripts/guard-lock.sh lock
trap 'scripts/guard-lock.sh unlock' EXIT

# --headless [--resume <session-id> "<message>"]: run non-interactively and print JSON with the
# session id. Bash is limited to the commands a migration needs; deny rules and the hook still apply.
if [ "${2:-}" = "--headless" ]; then
  allowed=(Read Write Edit Grep Glob Skill TodoWrite Agent
    "Bash(npm run *)" "Bash(npm test)" "Bash(npm test *)" "Bash(npx vitest *)" "Bash(npx tsc *)"
    "Bash(git add *)" "Bash(git commit *)" "Bash(git status)" "Bash(git status *)" "Bash(git log *)" "Bash(git diff *)"
    "Bash(cd *)" "Bash(ls *)" "Bash(ls)" "Bash(fd *)" "Bash(rg *)" "Bash(cat *)" "Bash(head *)" "Bash(tail *)"
    "Bash(wc *)" "Bash(jq *)" "Bash(docker ps *)")
  if [ "${3:-}" = "--resume" ]; then
    claude -p --resume "$4" "${settings[@]}" --allowedTools "${allowed[@]}" --output-format json "$5" < /dev/null
  else
    claude -p "${settings[@]}" --allowedTools "${allowed[@]}" --output-format json "$prompt" < /dev/null
  fi
  exit
fi
claude "${settings[@]}" "$prompt"
