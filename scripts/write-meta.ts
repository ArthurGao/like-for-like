// npm run meta -- <feature> <transcript.jsonl>
// Run by the human after a migration session. Writes runs/<last run>/meta.json from files only:
// the harness reports in runs/, the knowledge folder, git, and the session transcript.
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { auditTranscript } from '../audit/audit-session.ts';
import { countKnowledgeEntries, runsDir } from '../harness/lib/runs.ts';
import { runMain } from '../platform/cli.ts';

type Entry = { type?: string; isMeta?: boolean; timestamp?: string; message?: { content?: unknown } };

const SYSTEM_TEXT = /^\s*(<command-|<local-command|<system-reminder>|\[Request interrupted)/;

/** Text the human typed (not tool results, not slash-command plumbing). */
function humanText(e: Entry): string | null {
  if (e.type !== 'user' || e.isMeta) return null;
  const c = e.message?.content;
  if (typeof c === 'string') return SYSTEM_TEXT.test(c) ? null : c;
  if (!Array.isArray(c) || c.length === 0 || !c.every((b) => b?.type === 'text')) return null;
  const text = c.map((b) => String(b.text ?? '')).join('\n');
  return SYSTEM_TEXT.test(text) ? null : text;
}

/**
 * Session facts from a Claude Code transcript. The first human message starts the session;
 * every later one is the human resuming after the agent stopped.
 */
export function sessionStats(jsonl: string) {
  const entries = jsonl.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Entry);
  const times = entries.flatMap((e) => (e.timestamp ? [Date.parse(e.timestamp)] : [])).filter(Number.isFinite);
  const human = entries.filter((e) => humanText(e) !== null).length;
  return {
    startedAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    finishedAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
    durationMinutes: times.length ? Math.round((Math.max(...times) - Math.min(...times)) / 60_000) : null,
    humanStops: Math.max(0, human - 1),
  };
}

// Run only when executed directly (the unit test imports sessionStats).
if (import.meta.url === `file://${process.argv[1]}`) runMain(async () => {
  const [feature, transcript] = process.argv.slice(2);
  if (!feature || !transcript) throw new Error('usage: npm run meta -- <feature> <transcript.jsonl>');

  const runs: { run: string; knowledgeEntriesAtStart: number }[] = [];
  for (const dir of (await readdir(runsDir)).filter((d) => /^\d{3}$/.test(d)).sort()) {
    const report = JSON.parse(await readFile(new URL(`${dir}/report.json`, runsDir), 'utf8').catch(() => '{}'));
    if (report.feature === feature) runs.push({ run: dir, knowledgeEntriesAtStart: report.knowledgeEntriesAtStart });
  }
  const last = runs.at(-1);
  if (!last) throw new Error(`no harness reports for ${feature} in runs/`);

  const jsonl = await readFile(transcript, 'utf8');
  const audit = auditTranscript(jsonl);
  const meta = {
    run: last.run,
    feature,
    gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    session: { id: basename(transcript, '.jsonl'), ...sessionStats(jsonl) },
    harnessRuns: runs.length,
    harnessRunNumbers: runs.map((r) => r.run),
    knowledgeEntriesAtStart: runs[0]!.knowledgeEntriesAtStart,
    knowledgeEntriesAtEnd: await countKnowledgeEntries(),
    guardAudit: { toolCalls: audit.toolCalls, blockedAttempts: audit.blocked, findings: audit.findings },
  };
  const file = new URL(`${last.run}/meta.json`, runsDir);
  await writeFile(file, `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`meta: ${file.pathname}`);
  return audit.findings.length === 0 ? 0 : 1;
});
