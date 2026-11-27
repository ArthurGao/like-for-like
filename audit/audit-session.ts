// Audit a migration-session transcript (Claude Code JSONL) after the run:
//   npx tsx audit/audit-session.ts <transcript.jsonl>
// Fails if any tool result contains text from a file the session may not see (a leak), or if a
// tool call matching the guard patterns was not blocked. Read access is denied to the session.
import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { matchGuard } from '../.claude/hooks/guard-match.mjs';

type Block = { type: string; id?: string; tool_use_id?: string; name?: string; input?: unknown; content?: unknown; is_error?: boolean };
/** A call the guard or a permission deny rule actually stopped, as recorded in the transcript. */
export type BlockedCall = { tool: string; input: string; reason: string };
export type Finding = { kind: 'leak' | 'unblocked-attempt'; tool?: string; detail: string; line: number };

/** Text that appears only in files the migration session may not read. */
export const LEAK_MARKERS: readonly string[] = JSON.parse(
  readFileSync(new URL('./markers.json', import.meta.url), 'utf8'),
).markers;

const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];

const BLOCK_TEXT = /Blocked by the migration guard|denied by your permission settings/;

export function auditTranscript(jsonl: string): { toolCalls: number; blocked: number; blockedCalls: BlockedCall[]; findings: Finding[] } {
  const calls = new Map<string, { tool: string; input: string; matched: string | null; line: number }>();
  const findings: Finding[] = [];
  const blockedCalls: BlockedCall[] = [];
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
        const input = String((b.input as { command?: unknown; file_path?: unknown; path?: unknown } | undefined)?.command ??
          (b.input as { file_path?: unknown })?.file_path ?? (b.input as { path?: unknown })?.path ?? '');
        calls.set(b.id, { tool: b.name ?? '?', input: input.slice(0, 200), matched, line: i + 1 });
      }
      if (b.type === 'tool_result' && b.tool_use_id) {
        const call = calls.get(b.tool_use_id);
        const text = strings(b.content).join('\n');
        const leak = LEAK_MARKERS.find((m) => text.includes(m));
        if (b.is_error && BLOCK_TEXT.test(text)) {
          blockedCalls.push({ tool: call?.tool ?? '?', input: call?.input ?? '', reason: (BLOCK_TEXT.exec(text)![0]) + ': ' + text.replace(/^[\s\S]*?(matches|denied)/, '$1').slice(0, 160) });
        }
        if (leak) findings.push({ kind: 'leak', tool: call?.tool, detail: `result contains "${leak}"`, line: i + 1 });
        if (call?.matched) {
          if (b.is_error) blocked++;
          else findings.push({ kind: 'unblocked-attempt', tool: call.tool, detail: `matched "${call.matched}"`, line: call.line });
        }
      }
    }
  });
  return { toolCalls, blocked, blockedCalls, findings };
}

/** Audit a session transcript together with its subagents' transcripts (<session>/subagents/). */
export async function auditSession(transcriptPath: string, mainText?: string) {
  const subDir = `${transcriptPath.replace(/\.jsonl$/, '')}/subagents`;
  const subs = (await readdir(subDir).catch(() => [] as string[])).filter((f) => f.endsWith('.jsonl')).sort();
  const files = [transcriptPath, ...subs.map((f) => `${subDir}/${f}`)];
  let toolCalls = 0;
  let blocked = 0;
  const blockedCalls: BlockedCall[] = [];
  const findings: (Finding & { transcript: string })[] = [];
  for (const [i, file] of files.entries()) {
    const r = auditTranscript(i === 0 && mainText !== undefined ? mainText : await readFile(file, 'utf8'));
    toolCalls += r.toolCalls;
    blocked += r.blocked;
    blockedCalls.push(...r.blockedCalls);
    findings.push(...r.findings.map((f) => ({ ...f, transcript: i === 0 ? 'main' : subs[i - 1]! })));
  }
  return { transcripts: files.length, toolCalls, blocked, blockedCalls, findings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: npx tsx audit/audit-session.ts <transcript.jsonl>');
    process.exit(2);
  }
  const result = await auditSession(path);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.findings.length === 0 && result.toolCalls > 0 ? 0 : 1;
}
