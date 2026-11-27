import { describe, expect, it } from 'vitest';
import type { CompareRow, ShiftInputs } from '../lib/types.ts';
import { compareRecords } from './records.ts';
import { compareTenantTotals, compareWeekTotals, weekStart } from './totals.ts';

const row = (id: number, over: Partial<CompareRow> = {}): CompareRow => ({
  legacyShiftId: id,
  tenant: 'T1',
  employeeId: 1,
  employee: 'E1',
  work_date: '2026-03-25',
  paid_hours: '7.50',
  gross_pay: '200.00',
  ...over,
});
const inputs = new Map<number, ShiftInputs>([
  [2, { tenant: 'T1', employeeId: 1, timeZone: 'UTC', employee: 'E1', rate: '26.67', startLocal: '2026-03-25 09:00:00',
    endLocal: '2026-03-25 17:00:00', breakMin: 30, status: 2, active: true }],
]);

describe('compareRecords', () => {
  it('reports each differing field with both values and the inputs', () => {
    const { compared, mismatches } = compareRecords(
      [row(1), row(2)],
      [row(1, { paid_hours: '7.5' }), row(2, { paid_hours: '8.00', gross_pay: '213.36' })],
      inputs,
    );
    expect(compared).toBe(2);
    expect(mismatches.map((m) => [m.legacyShiftId, m.field, m.legacy, m.new])).toEqual([
      [2, 'paid_hours', '7.50', '8.00'],
      [2, 'gross_pay', '200.00', '213.36'],
    ]);
    expect(mismatches[0]!.startLocal).toBe('2026-03-25 09:00:00');
    expect(mismatches[0]!.triage).toBeNull();
  });

  it('reports rows missing on either side', () => {
    const { compared, mismatches } = compareRecords([row(1), row(2)], [row(2), row(3)], inputs);
    expect(compared).toBe(1);
    expect(mismatches.map((m) => [m.legacyShiftId, m.field, m.legacy, m.new])).toEqual([
      [1, 'row', 'present', 'absent'],
      [3, 'row', 'absent', 'present'],
    ]);
  });

  it('compares work dates as text', () => {
    const { mismatches } = compareRecords([row(1)], [row(1, { work_date: '2026-03-26' })], inputs);
    expect(mismatches.map((m) => m.field)).toEqual(['work_date']);
  });
});

describe('totals', () => {
  it('sums per tenant, including a tenant with no new rows', () => {
    const totals = compareTenantTotals(['T1', 'T2'], [row(1), row(2), row(3, { tenant: 'T2' })], [row(1), row(2)]);
    expect(totals).toEqual([
      { tenant: 'T1', legacyHours: '15.00', newHours: '15.00', legacyGross: '400.00', newGross: '400.00', ok: true },
      { tenant: 'T2', legacyHours: '7.50', newHours: '0.00', legacyGross: '200.00', newGross: '0.00', ok: false },
    ]);
  });

  it('groups weeks from Monday by work date', () => {
    expect(weekStart('2026-03-29')).toBe('2026-03-23'); // Sunday
    expect(weekStart('2026-03-30')).toBe('2026-03-30'); // Monday
    const weeks = compareWeekTotals(
      [row(1, { work_date: '2026-03-29' }), row(2, { work_date: '2026-03-30' })],
      [row(1, { work_date: '2026-03-29' }), row(2, { work_date: '2026-03-30', gross_pay: '200.01' })],
    );
    expect(weeks.map((w) => [w.weekStart, w.ok])).toEqual([
      ['2026-03-23', true],
      ['2026-03-30', false],
    ]);
  });
});
