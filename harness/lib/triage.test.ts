import { describe, expect, it } from 'vitest';
import { EXPLAINED, applyTriage, findTriage, parseTriage } from './triage.ts';

const yaml = `
decisions:
  - id: pay-diff
    match: { legacyShiftIds: [10, 11], field: gross_pay }
    decision: legacy-bug-fix
    reason: Legacy overpaid.
    decidedBy: payroll lead
  - id: anything-on-12
    match: { legacyShiftIds: [12] }
    decision: new-system-bug
    reason: New system is wrong.
    decidedBy: payroll lead
`;

describe('triage', () => {
  it('parses decisions and matches by shift id and field', () => {
    const entries = parseTriage(yaml);
    expect(entries.map((e) => e.id)).toEqual(['pay-diff', 'anything-on-12']);
    expect(findTriage(entries, 10, 'gross_pay')?.id).toBe('pay-diff');
    expect(findTriage(entries, 10, 'paid_hours')).toBeUndefined();
    expect(findTriage(entries, 12, 'work_date')?.id).toBe('anything-on-12');
    expect(findTriage(entries, 99, 'gross_pay')).toBeUndefined();
  });

  it('counts only legacy-bug-fix and acceptable as explained', () => {
    expect([...EXPLAINED].sort()).toEqual(['acceptable', 'legacy-bug-fix']);
  });

  it('reads an empty list', () => {
    expect(parseTriage('decisions: []\n')).toEqual([]);
    expect(parseTriage('# only comments\n')).toEqual([]);
  });

  it('rejects entries without a reason, a decider or a known decision', () => {
    const base = { id: 'x', match: { legacyShiftIds: [1] }, decision: 'acceptable', reason: 'r', decidedBy: 'd' };
    const doc = (e: object) => JSON.stringify({ decisions: [{ ...base, ...e }] });
    expect(() => parseTriage(doc({ reason: '' }))).toThrow('reason is required');
    expect(() => parseTriage(doc({ decidedBy: ' ' }))).toThrow('decidedBy is required');
    expect(() => parseTriage(doc({ decision: 'ignore' }))).toThrow('decision must be one of');
    expect(() => parseTriage(doc({ match: { legacyShiftIds: [] } }))).toThrow('non-empty list');
  });

  it('marks a tenant unexplained while any of its mismatches lacks an explaining decision', () => {
    const m = (legacyShiftId: number, tenant: string, field: string) => ({ legacyShiftId, tenant, field, triage: null });
    const result = applyTriage(
      [m(10, 'T1', 'gross_pay'), m(12, 'T2', 'paid_hours'), m(13, 'T3', 'paid_hours')],
      parseTriage(yaml),
    );
    expect(result.mismatches.map((x) => x.triage?.decision ?? null)).toEqual(['legacy-bug-fix', 'new-system-bug', null]);
    expect(result.unexplained.map((x) => x.legacyShiftId)).toEqual([12, 13]);
    expect([...result.unexplainedTenants]).toEqual(['T2', 'T3']);
    expect(result.applied).toEqual(['pay-diff', 'anything-on-12']);
    expect(result.unmatched).toEqual([]);
    expect(applyTriage([m(13, 'T3', 'paid_hours')], parseTriage(yaml)).unmatched).toEqual(['pay-diff', 'anything-on-12']);
  });
});
