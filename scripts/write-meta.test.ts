import { describe, expect, it } from 'vitest';
import { sessionStats } from './write-meta.ts';

const user = (timestamp: string, content: unknown, extra: object = {}) =>
  JSON.stringify({ type: 'user', timestamp, message: { content }, ...extra });
const assistant = (timestamp: string) => JSON.stringify({ type: 'assistant', timestamp, message: { content: [{ type: 'text', text: 'ok' }] } });

describe('sessionStats', () => {
  it('counts each human message after the first as a stop and measures the duration', () => {
    const jsonl = [
      user('2026-11-28T09:00:00Z', 'Use the migrate-feature skill to migrate the timesheet feature.'),
      assistant('2026-11-28T09:05:00Z'),
      user('2026-11-28T09:05:01Z', [{ type: 'tool_result', tool_use_id: 'x', content: 'done' }]),
      user('2026-11-28T09:20:00Z', 'Yes, commit.'),
      user('2026-11-28T09:30:00Z', [{ type: 'text', text: 'Triage is in harness/triage.yaml, continue.' }]),
      user('2026-11-28T09:30:01Z', '<command-name>/cost</command-name>'),
      user('2026-11-28T09:30:02Z', 'caveat', { isMeta: true }),
      assistant('2026-11-28T10:15:00Z'),
    ].join('\n');
    expect(sessionStats(jsonl)).toEqual({
      startedAt: '2026-11-28T09:00:00.000Z',
      finishedAt: '2026-11-28T10:15:00.000Z',
      durationMinutes: 75,
      humanStops: 2,
    });
  });

  it('reports nothing for an empty transcript', () => {
    expect(sessionStats('')).toEqual({ startedAt: null, finishedAt: null, durationMinutes: null, humanStops: 0 });
  });
});
