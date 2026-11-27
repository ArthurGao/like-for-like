import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchGuard, policy } from '../.claude/hooks/guard-match.mjs';
import { auditSession, auditTranscript } from './audit-session.ts';

const line = (content: object[]) => JSON.stringify({ message: { content } });
const use = (id: string, name: string, input: object) => ({ type: 'tool_use', id, name, input });
const result = (id: string, content: string, is_error = false) => ({ type: 'tool_result', tool_use_id: id, content, is_error });

describe('auditTranscript', () => {
  it('passes a clean session', () => {
    const jsonl = [
      line([use('1', 'Read', { file_path: '/r/features/timesheet/brief.md' })]),
      line([result('1', '# Feature brief')]),
    ].join('\n');
    expect(auditTranscript(jsonl)).toEqual({ toolCalls: 1, blocked: 0, blockedCalls: [], findings: [] });
  });

  it('counts a blocked attempt without failing', () => {
    const jsonl = [
      line([use('1', 'Bash', { command: 'cat legacy/logic/timesheet.sql' })]),
      line([result('1', 'Blocked by the migration guard', true)]),
    ].join('\n');
    expect(auditTranscript(jsonl)).toMatchObject({ blocked: 1, findings: [] });
    expect(auditTranscript(jsonl).blockedCalls.map((c) => [c.tool, c.input])).toEqual([['Bash', 'cat legacy/logic/timesheet.sql']]);
  });

  it('flags an attempt that was not blocked', () => {
    const jsonl = [
      line([use('1', 'Bash', { command: 'git show HEAD~3' })]),
      line([result('1', 'diff --git ...')]),
    ].join('\n');
    expect(auditTranscript(jsonl).findings).toEqual([
      { kind: 'unblocked-attempt', tool: 'Bash', detail: 'matched "command \\bgit\\s+show\\b"', line: 1 },
    ]);
  });

  it('flags a leak even when the call looked harmless', () => {
    const jsonl = [
      line([use('1', 'Bash', { command: 'node x.js' })]),
      line([result('1', '-- The ORIGINAL behaviour. Black box to the migration agent')]),
    ].join('\n');
    expect(auditTranscript(jsonl).findings.map((f) => f.kind)).toEqual(['leak']);
  });
});

describe('guard policy', () => {
  it('covers every path the migration settings deny', () => {
    const settings = JSON.parse(readFileSync(new URL('../.claude/migration-settings.json', import.meta.url), 'utf8'));
    const deny: string[] = settings.permissions.deny;
    const paths = (kind: string) =>
      deny.filter((r) => r.startsWith(`${kind}(./`)).map((r) => r.slice(kind.length + 3, -1).replace(/\/\*\*$/, ''));
    expect(paths('Read').filter((p) => !policy.readPaths.includes(p))).toEqual([]);
    expect(paths('Edit').filter((p) => !policy.writePaths.includes(p))).toEqual([]);
  });

  it('normalises file paths and only blocks writes under write-protected folders', () => {
    expect(matchGuard('Read', { file_path: 'legacy//logic/./timesheet.sql' }, '/r')).toBe('path legacy/logic');
    expect(matchGuard('Read', { file_path: '/r/features/../docs/x.md' }, '/r')).toBe('path docs');
    expect(matchGuard('Read', { file_path: '/r/harness/run.ts' }, '/r')).toBeUndefined();
    expect(matchGuard('Edit', { file_path: '/r/harness/run.ts' }, '/r')).toBe('path harness');
    expect(matchGuard('Write', { file_path: '/r/features/timesheet/mapping.md', content: 'see docs/ later' }, '/r')).toBeUndefined();
  });

  it('blocks searches that would reach a protected folder and Bash writes to protected paths', () => {
    expect(matchGuard('Grep', { pattern: 'x', path: '/r/legacy' }, '/r')).toBe('path legacy/logic');
    expect(matchGuard('Grep', { pattern: 'x', path: '/r' }, '/r')).toBe('path legacy/logic');
    expect(matchGuard('Grep', { pattern: 'x' }, '/r')).toMatch(/^path /);
    expect(matchGuard('Grep', { pattern: 'x', path: '/r/features' }, '/r')).toBeUndefined();
    expect(matchGuard('Bash', { command: 'echo ok > harness/triage.yaml' }, '/r')).toBe('write to harness');
    expect(matchGuard('Bash', { command: "sed -i '' s/a/b/ package.json" }, '/r')).toBe('write to package.json');
    expect(matchGuard('Bash', { command: 'npm install decimal.js' }, '/r')).toMatch(/^command /);
    expect(matchGuard('Bash', { command: 'npx tsx harness/run.ts timesheet' }, '/r')).toBeUndefined();
    expect(matchGuard('Bash', { command: 'cp /tmp/x features/timesheet/calc.ts' }, '/r')).toBeUndefined();
    expect(matchGuard('Bash', { command: "psql -c 'select routine_definition from information_schema.routines'" }, '/r')).toMatch(/^mention /);
  });

  it('does not treat stream redirects or npm script names as writes to protected paths', () => {
    expect(matchGuard('Bash', { command: 'npm run legacy:sample 2>&1 | head -100' }, '/r')).toBeUndefined();
    expect(matchGuard('Bash', { command: 'npm run harness -- timesheet 2>&1 | tail -60' }, '/r')).toBeUndefined();
    expect(matchGuard('Bash', { command: 'fd -t f . features platform harness 2>/dev/null | xargs wc -l' }, '/r')).toBeUndefined();
    expect(matchGuard('Bash', { command: 'npm run harness -- timesheet > harness/out.txt' }, '/r')).toBe('write to harness');
    expect(matchGuard('Bash', { command: 'echo x >> /r/harness/triage.yaml' }, '/r')).toBe('write to harness');
    expect(matchGuard('Bash', { command: 'cp /tmp/x harness;ls' }, '/r')).toBe('write to harness');
    expect(matchGuard('Bash', { command: 'echo {} > package.json&&ls' }, '/r')).toBe('write to package.json');
    expect(matchGuard('Bash', { command: 'touch legacy|cat' }, '/r')).toBe('write to legacy');
    expect(matchGuard('Bash', { command: 'npm run legacy:sample > /tmp/sample.txt' }, '/r')).toBeUndefined();
    expect(matchGuard('Bash', { command: 'echo x>harness/a' }, '/r')).toBe('write to harness');
    expect(matchGuard('Bash', { command: 'echo `touch harness/a`' }, '/r')).toBe('write to harness');
    expect(matchGuard('Bash', { command: 'fd -e ts . features -x cat' }, '/r')).toMatch(/^command /);
    expect(matchGuard('Bash', { command: "rg --pre ./x.sh TIMEZONE features" }, '/r')).toMatch(/^command /);
    expect(matchGuard('Bash', { command: 'fd -e ts . features' }, '/r')).toBeUndefined();
    expect(matchGuard('Bash', { command: 'npm run x>harness/a' }, '/r')).toBe('write to harness');
    expect(matchGuard('Bash', { command: 'npm run x;cp a harness/b' }, '/r')).toBe('write to harness');
  });
});

describe('auditSession', () => {
  it('audits the subagent transcripts next to the session transcript', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-'));
    const main = join(dir, 'sess.jsonl');
    writeFileSync(main, [line([use('1', 'Read', { file_path: '/r/README.md' })]), line([result('1', 'ok')])].join('\n'));
    mkdirSync(join(dir, 'sess', 'subagents'), { recursive: true });
    writeFileSync(join(dir, 'sess', 'subagents', 'agent-x.jsonl'),
      [line([use('2', 'Bash', { command: 'node y.js' })]), line([result('2', 'SEEDED ON PURPOSE')])].join('\n'));
    const r = await auditSession(main);
    expect([r.transcripts, r.toolCalls]).toEqual([2, 2]);
    expect(r.findings.map((f) => [f.kind, f.transcript])).toEqual([['leak', 'agent-x.jsonl']]);
  });
});

describe('guard-lock', () => {
  it('covers the whole trust base, including what only the builder may read', () => {
    const status = execFileSync('scripts/guard-lock.sh', ['status'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    const paths = status.trim().split('\n').map((l) => l.replace(/^(writable|read-only)\s+/, ''));
    for (const p of ['harness', 'legacy', 'platform', 'scripts', '.claude', 'package.json', 'package-lock.json', 'tsconfig.json',
      'vitest.config.ts', 'vitest.private.config.ts', 'docker-compose.yml', 'CLAUDE.md', 'docs', 'audit', '.git/hooks']) {
      expect(paths).toContain(p);
    }
  });
});
