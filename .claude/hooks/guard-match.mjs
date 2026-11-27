// Shared by the PreToolUse hook (guard.mjs) and the post-run audit, so both apply one policy.
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const policy = JSON.parse(readFileSync(new URL('./guard-patterns.json', import.meta.url), 'utf8'));

const PATH_KEYS = ['file_path', 'path', 'notebook_path'];
const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
const SEARCH_TOOLS = new Set(['Grep', 'Glob', 'LS']);

const strings = (v) =>
  typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];

const under = (rel, prefixes) => prefixes.find((p) => rel === p || rel.startsWith(`${p}/`));
/** A protected prefix inside the directory rel (a search rooted at rel would reach it). */
const contains = (rel, prefixes) => prefixes.find((p) => rel === '' || p.startsWith(`${rel}/`));

/** Resolve symlinks for the longest existing part of the path, keep the rest as written. */
function real(abs) {
  let head = abs;
  const tail = [];
  while (head !== path.dirname(head)) {
    try {
      return path.join(realpathSync(head), ...tail.reverse());
    } catch {
      tail.push(path.basename(head));
      head = path.dirname(head);
    }
  }
  return abs;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The rule a tool call breaks, or undefined. projectDir resolves relative path arguments. */
export function matchGuard(tool, input = {}, projectDir = process.cwd()) {
  const root = real(path.resolve(projectDir));
  for (const key of PATH_KEYS) {
    if (typeof input[key] !== 'string') continue;
    const rel = path.relative(root, real(path.resolve(root, input[key]))).split(path.sep).join('/');
    const hit =
      under(rel, policy.readPaths) ??
      (WRITE_TOOLS.has(tool) ? under(rel, policy.writePaths) : undefined) ??
      (SEARCH_TOOLS.has(tool) && !rel.startsWith('..') ? contains(rel, policy.readPaths) : undefined);
    if (hit) return `path ${hit}`;
  }
  if (SEARCH_TOOLS.has(tool) && typeof input.path !== 'string') {
    return `path ${policy.readPaths[0]} (search of the whole project; give a folder)`;
  }
  const text = strings(input).join('\n').toLowerCase();
  const mention = policy.mentions.find((m) => text.includes(m.toLowerCase()));
  if (mention) return `mention ${mention}`;
  if (tool === 'Bash') {
    const command = String(input.command ?? '');
    const regex = policy.commandRegexes.find((r) => new RegExp(r, 'i').test(command));
    if (regex) return `command ${regex}`;
    if (new RegExp(policy.writeCommandRegex, 'i').test(command)) {
      const target = policy.writePaths.find((p) => new RegExp(`(^|[\\s'"=:(])(\\./)?${escape(p)}(/|\\b|$)`).test(command));
      if (target) return `write to ${target}`;
    }
  }
  return undefined;
}
