// Builder-only: the seeded wrong calculation differs from legacy only where intended.
import { describe, expect, it } from 'vitest';
import type { ShiftInputs } from '../lib/types.ts';
import { wrongCalc } from '../seeded-fault.ts';

const shift = (startLocal: string, endLocal: string, breakMin: number | null, over: Partial<ShiftInputs> = {}): ShiftInputs => ({
  tenant: 'T', employeeId: 1, timeZone: 'Pacific/Auckland', employee: 'E', rate: '25.10',
  startLocal, endLocal, breakMin, status: 2, active: true, ...over,
});
const calc = (...shifts: ShiftInputs[]) => wrongCalc(new Map(shifts.map((s, i) => [i + 1, s])));

describe('wrongCalc (seeded fault)', () => {
  it('counts an overnight shift as the plain wall-clock difference', () => {
    const [r] = calc(shift('2026-04-04 22:00:00', '2026-04-05 06:00:00', null));
    expect([r!.work_date, r!.paid_hours, r!.gross_pay]).toEqual(['2026-04-04', '7.50', '188.25']);
  });

  it('implements break, rounding and pay rules correctly', () => {
    const rows = calc(
      shift('2026-03-25 09:00:00', '2026-03-25 14:00:00', null),
      shift('2026-03-26 09:00:00', '2026-03-26 14:01:00', null),
      shift('2026-09-16 08:00:00', '2026-09-16 15:07:30', 0),
      shift('2026-09-18 08:00:00', '2026-09-18 15:15:00', 0),
    );
    expect(rows.map((r) => [r.paid_hours, r.gross_pay])).toEqual([
      ['5.00', '125.50'],
      ['4.50', '112.95'],
      ['7.25', '181.98'],
      ['7.25', '181.98'],
    ]);
  });

  it('skips draft and deleted shifts', () => {
    expect(calc(shift('2026-01-01 09:00:00', '2026-01-01 10:00:00', 0, { status: 1 }),
      shift('2026-01-01 09:00:00', '2026-01-01 10:00:00', 0, { active: false }))).toEqual([]);
  });
});
