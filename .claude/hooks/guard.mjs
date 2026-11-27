#!/usr/bin/env node
// PreToolUse hook for the migration session only (registered in .claude/migration-settings.json).
// Second line of defence behind the permission deny rules, which are best-effort.

// Fail closed: a hook that crashes exits 1, which Claude Code treats as non-blocking.
process.on('uncaughtException', (err) => {
  process.stderr.write(`Blocked by the migration guard: could not check this call (${err.message}).\n`);
  process.exit(2);
});

const { matchGuard } = await import('./guard-match.mjs');

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const { tool_name: tool, tool_input: input, cwd } = JSON.parse(raw);
const rule = matchGuard(tool, input ?? {}, process.env.CLAUDE_PROJECT_DIR ?? cwd);

if (rule) {
  process.stderr.write(
    `Blocked by the migration guard: this ${tool} call matches ${rule}, ` +
      'which is outside what the migration session may read, write or run.\n',
  );
  process.exit(2);
}
process.exit(0);
