// Shared by the PreToolUse hook (guard.mjs) and the post-run audit, so both apply one policy.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const policy = JSON.parse(readFileSync(new URL('./guard-patterns.json', import.meta.url), 'utf8'));

const PATH_KEYS = ['file_path', 'path', 'notebook_path'];
const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

const strings = (v) =>
  typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];

const under = (rel, prefixes) => prefixes.find((p) => rel === p || rel.startsWith(`${p}/`));

/** The rule a tool call breaks, or undefined. projectDir resolves relative path arguments. */
export function matchGuard(tool, input = {}, projectDir = process.cwd()) {
  const root = path.resolve(projectDir);
  for (const key of PATH_KEYS) {
    if (typeof input[key] !== 'string') continue;
    const rel = path.relative(root, path.resolve(root, input[key])).split(path.sep).join('/');
    const hit = under(rel, policy.readPaths) ?? (WRITE_TOOLS.has(tool) ? under(rel, policy.writePaths) : undefined);
    if (hit) return `path ${hit}`;
  }
  const text = strings(input).join('\n').toLowerCase();
  const mention = policy.mentions.find((m) => text.includes(m.toLowerCase()));
  if (mention) return `mention ${mention}`;
  if (tool === 'Bash') {
    const regex = policy.commandRegexes.find((r) => new RegExp(r, 'i').test(String(input.command ?? '')));
    if (regex) return `command ${regex}`;
  }
  return undefined;
}
