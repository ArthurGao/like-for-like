// npm run meta -- <feature> <transcript.jsonl>
// Run by the human after a migration session. Writes runs/<last run>/meta.json from files only:
// the harness reports in runs/, the knowledge folder, git, and the session transcript.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename } from 'node:path';
import { auditSession } from '../audit/audit-session.ts';
import { countKnowledgeEntries, readRunReports, runsDir } from '../harness/lib/runs.ts';
import { runMain } from '../platform/cli.ts';

type Entry = { type?: string; isMeta?: boolean; origin?: unknown; timestamp?: string; message?: { content?: unknown } };

const SYSTEM_TEXT = /^\s*(<command-|<local-command|<system-reminder>|<task-notification>|\[Request interrupted)/;

/** Text the human typed (not tool results, not slash-command plumbing). */
function humanText(e: Entry): string | null {
  // origin is set on messages the harness injects (task notifications and the like), never on typed ones.
  if (e.type !== 'user' || e.isMeta || e.origin) return null;
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

  const runs = (await readRunReports(feature)).map((r) => ({ run: r.id, knowledgeEntriesAtStart: r.report.knowledgeEntriesAtStart }));
  const last = runs.at(-1);
  if (!last) throw new Error(`no harness reports for ${feature} in runs/`);

  const jsonl = await readFile(transcript, 'utf8');
  const audit = await auditSession(transcript, jsonl);
  const meta = {
    run: last.run,
    feature,
    gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    session: { id: basename(transcript, '.jsonl'), ...sessionStats(jsonl) },
    harnessRuns: runs.length,
    harnessRunNumbers: runs.map((r) => r.run),
    knowledgeEntriesAtStart: runs[0]!.knowledgeEntriesAtStart,
    knowledgeEntriesAtEnd: await countKnowledgeEntries(),
    guardAudit: {
      transcripts: audit.transcripts,
      toolCalls: audit.toolCalls,
      /** Calls the guard or a deny rule stopped during the session, whatever today's rules say. */
      blockedCalls: audit.blockedCalls,
      /** Of the calls today's rules would stop, how many were stopped. */
      guardedAttemptsBlocked: audit.blocked,
      findings: audit.findings,
    },
  };
  const file = new URL(`${last.run}/meta.json`, runsDir);
  // The file is published: replace machine paths (checkout, home folder) with . and ~.
  const text = JSON.stringify(meta, null, 2).split(process.cwd()).join('.').split(homedir()).join('~');
  await writeFile(file, `${text}\n`);
  console.log(`meta: ${file.pathname}`);
  return audit.findings.length === 0 ? 0 : 1;
});
