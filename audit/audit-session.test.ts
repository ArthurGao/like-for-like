import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { matchGuard, policy } from '../.claude/hooks/guard-match.mjs';
import { auditTranscript } from './audit-session.ts';

const line = (content: object[]) => JSON.stringify({ message: { content } });
const use = (id: string, name: string, input: object) => ({ type: 'tool_use', id, name, input });
const result = (id: string, content: string, is_error = false) => ({ type: 'tool_result', tool_use_id: id, content, is_error });

describe('auditTranscript', () => {
  it('passes a clean session', () => {
    const jsonl = [
      line([use('1', 'Read', { file_path: '/r/features/timesheet/brief.md' })]),
      line([result('1', '# Feature brief')]),
    ].join('\n');
    expect(auditTranscript(jsonl)).toEqual({ toolCalls: 1, blocked: 0, findings: [] });
  });

  it('counts a blocked attempt without failing', () => {
    const jsonl = [
      line([use('1', 'Bash', { command: 'cat legacy/logic/timesheet.sql' })]),
      line([result('1', 'Blocked by the migration guard', true)]),
    ].join('\n');
    expect(auditTranscript(jsonl)).toMatchObject({ blocked: 1, findings: [] });
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
});
