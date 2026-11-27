import { describe, expect, it } from 'vitest';
import { checkMeta, checkReport } from './validate.ts';

const report = {
  feature: 'timesheet',
  knowledgeEntriesAtStart: 0,
  summary: { checks: 5, passed: 5, failed: 0, recordsCompared: 914, mismatches: 1, unexplained: 0 },
  mismatches: [{ legacyShiftId: 7 }],
};

describe('checkReport', () => {
  it('accepts a report from a known feature with integer figures', () => {
    expect(checkReport('001', report)).toBe(report);
  });

  it('refuses a feature the registry does not know (it is used in file paths)', () => {
    expect(() => checkReport('001', { ...report, feature: '../docs' })).toThrow('run 001: unknown feature "../docs"');
  });

  it('refuses figures that are not integers (they are written into the page)', () => {
    expect(() => checkReport('001', { ...report, summary: { ...report.summary, passed: '<img src=x>' } }))
      .toThrow('run 001: summary.passed is not an integer');
    expect(() => checkReport('001', { ...report, mismatches: [{ legacyShiftId: '1<b>' }] }))
      .toThrow('run 001: mismatches[0].legacyShiftId is not an integer');
  });
});

describe('checkMeta', () => {
  it('refuses non-integer figures and accepts missing optional ones', () => {
    expect(() => checkMeta('002', { harnessRuns: 2, session: { durationMinutes: '<x>' } }))
      .toThrow('run 002: meta session.durationMinutes is not an integer');
    expect(checkMeta('002', { harnessRuns: 2, session: { humanStops: 1 } })).toEqual({ harnessRuns: 2, session: { humanStops: 1 } });
  });
});
