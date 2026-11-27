import { describe, expect, it } from 'vitest';
import { clockShiftRows, pairEvents, type ClockEventInput } from './calc.ts';

const AKL = 'Pacific/Auckland'; // NZDT +13 until 2026-04-05 03:00, then NZST +12
const BNE = 'Australia/Brisbane'; // +10, no DST

const T = '00000000-0000-0000-0000-00000000000a';
const E1 = '00000000-0000-0000-0000-0000000000e1';
const E2 = '00000000-0000-0000-0000-0000000000e2';

/** Instants are given in UTC; comments give the local wall-clock times. */
function ev(
  id: string,
  eventType: 'in' | 'out',
  occurredAt: string,
  opts: { employeeId?: string; deleted?: boolean; timeZone?: string; hourlyRate?: string } = {},
): ClockEventInput {
  return {
    id,
    tenantId: T,
    employeeId: opts.employeeId ?? E1,
    eventType,
    occurredAt,
    deleted: opts.deleted ?? false,
    timeZone: opts.timeZone ?? BNE,
    hourlyRate: opts.hourlyRate ?? '25.10',
  };
}

const pairIds = (events: ClockEventInput[]) => pairEvents(events).map((p) => [p.clockIn.id, p.clockOut.id]);

describe('pairEvents: which events count (rule 1)', () => {
  it('ignores a deleted clock-out, so the clock-in is not paid', () => {
    expect(
      pairIds([ev('in1', 'in', '2026-03-23T00:00:00Z'), ev('out1', 'out', '2026-03-23T04:00:00Z', { deleted: true })]),
    ).toEqual([]);
  });

  it('ignores a deleted clock-in, and the clock-out with no clock-in before it is ignored too', () => {
    expect(
      pairIds([ev('in1', 'in', '2026-03-23T00:00:00Z', { deleted: true }), ev('out1', 'out', '2026-03-23T04:00:00Z')]),
    ).toEqual([]);
  });

  it('skips a deleted event between a clock-in and its clock-out', () => {
    expect(
      pairIds([
        ev('in1', 'in', '2026-03-23T00:00:00Z'),
        ev('in2', 'in', '2026-03-23T01:00:00Z', { deleted: true }),
        ev('out1', 'out', '2026-03-23T04:00:00Z'),
      ]),
    ).toEqual([['in1', 'out1']]);
  });
});

describe('pairEvents: pairs (rule 2)', () => {
  it('pairs a clock-in with the next event when it is a clock-out', () => {
    expect(pairIds([ev('in1', 'in', '2026-03-23T00:00:00Z'), ev('out1', 'out', '2026-03-23T04:00:00Z')])).toEqual([
      ['in1', 'out1'],
    ]);
  });

  it('does not pay a clock-in followed by another clock-in; the second one pairs', () => {
    expect(
      pairIds([
        ev('in1', 'in', '2026-03-23T00:00:00Z'),
        ev('in2', 'in', '2026-03-23T01:00:00Z'),
        ev('out1', 'out', '2026-03-23T04:00:00Z'),
      ]),
    ).toEqual([['in2', 'out1']]);
  });

  it('does not pay a clock-in followed by nothing', () => {
    expect(
      pairIds([
        ev('in1', 'in', '2026-03-23T00:00:00Z'),
        ev('out1', 'out', '2026-03-23T04:00:00Z'),
        ev('in2', 'in', '2026-03-24T00:00:00Z'),
      ]),
    ).toEqual([['in1', 'out1']]);
  });

  it('ignores a clock-out with no clock-in before it, and a second clock-out in a row', () => {
    expect(
      pairIds([
        ev('out0', 'out', '2026-03-22T23:00:00Z'),
        ev('in1', 'in', '2026-03-23T00:00:00Z'),
        ev('out1', 'out', '2026-03-23T04:00:00Z'),
        ev('out2', 'out', '2026-03-23T05:00:00Z'),
      ]),
    ).toEqual([['in1', 'out1']]);
  });

  it('orders by time, not by the order the events were entered', () => {
    // Entered late: the clock-out comes first in the input, and an earlier clock-in last.
    expect(
      pairIds([
        ev('out1', 'out', '2026-03-23T04:00:00Z'),
        ev('in2', 'in', '2026-03-23T06:00:00Z'),
        ev('in1', 'in', '2026-03-23T00:00:00Z'),
        ev('out2', 'out', '2026-03-23T09:00:00Z'),
      ]),
    ).toEqual([
      ['in1', 'out1'],
      ['in2', 'out2'],
    ]);
  });

  it('pairs each employee with their own events only', () => {
    // E1 clocks in, E2 clocks out, then E1 clocks out and in again (never out): only E1's
    // first pair counts; E2's clock-out closes neither of E1's clock-ins.
    expect(
      pairIds([
        ev('in1', 'in', '2026-03-23T00:00:00Z', { employeeId: E1 }),
        ev('outB', 'out', '2026-03-23T02:00:00Z', { employeeId: E2 }),
        ev('out1', 'out', '2026-03-23T04:00:00Z', { employeeId: E1 }),
        ev('in2', 'in', '2026-03-23T06:00:00Z', { employeeId: E1 }),
        ev('outC', 'out', '2026-03-23T07:00:00Z', { employeeId: E2 }),
      ]),
    ).toEqual([['in1', 'out1']]);
  });

  it('compares instants, not text, when events have different UTC offsets in the input', () => {
    // 2026-03-23T10:00+10:00 is 00:00Z, before 03:00Z.
    expect(
      pairIds([ev('out1', 'out', '2026-03-23T03:00:00Z'), ev('in1', 'in', '2026-03-23T10:00:00+10:00')]),
    ).toEqual([['in1', 'out1']]);
  });
});

describe('clockShiftRows: hours, break, pay and work date (rules 3-6)', () => {
  it('takes 30 minutes break when hours worked are more than 5', () => {
    // 07:22-14:36 Brisbane = 434 min; 434 - 30 = 404 -> 6.75 h; 6.75 * 25.10 = 169.425 -> 169.43
    const rows = clockShiftRows([ev('in1', 'in', '2026-03-22T21:22:00Z'), ev('out1', 'out', '2026-03-23T04:36:00Z')]);
    expect(rows).toEqual([
      { clock_in_id: 'in1', tenant_id: T, employee_id: E1, work_date: '2026-03-23', paid_hours: '6.75', gross_pay: '169.43' },
    ]);
  });

  it('takes no break at exactly 5 hours', () => {
    const rows = clockShiftRows([ev('in1', 'in', '2026-03-23T00:00:00Z'), ev('out1', 'out', '2026-03-23T05:00:00Z')]);
    expect(rows.map((r) => [r.paid_hours, r.gross_pay])).toEqual([['5.00', '125.50']]);
  });

  it('rounds paid time to the nearest quarter, exactly halfway up, and pay half a cent up', () => {
    // 457.5 min worked - 30 = 427.5 min = 7.125 h, exactly between 7.00 and 7.25 -> 7.25 h
    // 7.25 * 25.10 = 181.975 -> 181.98
    const rows = clockShiftRows([ev('in1', 'in', '2026-03-23T00:00:00Z'), ev('out1', 'out', '2026-03-23T07:37:30Z')]);
    expect(rows.map((r) => [r.paid_hours, r.gross_pay])).toEqual([['7.25', '181.98']]);
  });

  it('counts real elapsed time on the night clocks go back in Auckland', () => {
    // 2026-04-04 22:00 +13 (09:00Z) to 2026-04-05 06:00 +12 (18:00Z): 9 h elapsed, wall clock says 8 h.
    // 9 h - 30 min = 8.50 h; 8.5 * 25.10 = 213.35
    const rows = clockShiftRows([
      ev('in1', 'in', '2026-04-04T09:00:00Z', { timeZone: AKL }),
      ev('out1', 'out', '2026-04-04T18:00:00Z', { timeZone: AKL }),
    ]);
    expect(rows.map((r) => [r.work_date, r.paid_hours, r.gross_pay])).toEqual([['2026-04-04', '8.50', '213.35']]);
  });

  it('uses the local date of the clock-in, not the UTC date', () => {
    // 2026-03-23 08:00 Auckland is 2026-03-22T19:00Z.
    const rows = clockShiftRows([
      ev('in1', 'in', '2026-03-22T19:00:00Z', { timeZone: AKL }),
      ev('out1', 'out', '2026-03-23T00:00:00Z', { timeZone: AKL }),
    ]);
    expect(rows.map((r) => r.work_date)).toEqual(['2026-03-23']);
  });

  it('uses the employee hourly rate of the clock-in', () => {
    // 4 h * 38.57 = 154.28
    const rows = clockShiftRows([
      ev('in1', 'in', '2026-03-23T00:00:00Z', { hourlyRate: '38.57' }),
      ev('out1', 'out', '2026-03-23T04:00:00Z', { hourlyRate: '38.57' }),
    ]);
    expect(rows.map((r) => r.gross_pay)).toEqual(['154.28']);
  });

  it('pays 0.00 for a clock-out at the same instant as the clock-in', () => {
    const rows = clockShiftRows([ev('in1', 'in', '2026-03-23T00:00:00Z'), ev('out1', 'out', '2026-03-23T00:00:00Z')]);
    expect(rows.map((r) => [r.clock_in_id, r.paid_hours, r.gross_pay])).toEqual([['in1', '0.00', '0.00']]);
  });

  it('names the clock-in when a pair cannot be paid', () => {
    expect(() =>
      clockShiftRows([
        ev('in1', 'in', '2026-03-23T00:00:00Z', { hourlyRate: '25.1' }),
        ev('out1', 'out', '2026-03-23T04:00:00Z', { hourlyRate: '25.1' }),
      ]),
    ).toThrow('clock-in in1: not a money amount: 25.1');
  });
});
