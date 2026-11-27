// Audit a migration-session transcript (Claude Code JSONL) after the run:
//   npx tsx audit/audit-session.ts <transcript.jsonl>
// Fails if any tool result contains text from a file the session may not see (a leak), or if a
// tool call matching the guard patterns was not blocked. Read access is denied to the session.
import { readFileSync } from 'node:fs';
import { matchGuard } from '../.claude/hooks/guard-match.mjs';

type Block = { type: string; id?: string; tool_use_id?: string; name?: string; input?: unknown; content?: unknown; is_error?: boolean };
export type Finding = { kind: 'leak' | 'unblocked-attempt'; tool?: string; detail: string; line: number };

/** Text that appears only in files the migration session may not read. */
export const LEAK_MARKERS: readonly string[] = JSON.parse(
  readFileSync(new URL('./markers.json', import.meta.url), 'utf8'),
).markers;

const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];

export function auditTranscript(jsonl: string): { toolCalls: number; blocked: number; findings: Finding[] } {
  const calls = new Map<string, { tool: string; matched: string | null; line: number }>();
  const findings: Finding[] = [];
  let toolCalls = 0;
  let blocked = 0;

  jsonl.split('\n').forEach((raw, i) => {
    if (!raw.trim()) return;
    const entry = JSON.parse(raw) as { cwd?: string; message?: { content?: unknown } };
    const content = entry.message?.content;
    if (!Array.isArray(content)) return;
    for (const b of content as Block[]) {
      if (b.type === 'tool_use' && b.id) {
        toolCalls++;
        const matched = matchGuard(b.name ?? '', (b.input ?? {}) as Record<string, unknown>, entry.cwd) ?? null;
        calls.set(b.id, { tool: b.name ?? '?', matched, line: i + 1 });
      }
      if (b.type === 'tool_result' && b.tool_use_id) {
        const call = calls.get(b.tool_use_id);
        const text = strings(b.content).join('\n');
        const leak = LEAK_MARKERS.find((m) => text.includes(m));
        if (leak) findings.push({ kind: 'leak', tool: call?.tool, detail: `result contains "${leak}"`, line: i + 1 });
        if (call?.matched) {
          if (b.is_error) blocked++;
          else findings.push({ kind: 'unblocked-attempt', tool: call.tool, detail: `matched "${call.matched}"`, line: call.line });
        }
      }
    }
  });
  return { toolCalls, blocked, findings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: npx tsx audit/audit-session.ts <transcript.jsonl>');
    process.exit(2);
  }
  const result = auditTranscript(readFileSync(path, 'utf8'));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.findings.length === 0 && result.toolCalls > 0 ? 0 : 1;
}
