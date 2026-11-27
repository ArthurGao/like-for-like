import { describe, expect, it } from 'vitest';
import { computePay, isPayable, type PayInput } from './calc.ts';

const AKL = 'Pacific/Auckland'; // NZDT +13 until 2026-04-05 03:00, then NZST +12
const BNE = 'Australia/Brisbane'; // +10, no DST

/** Instants are given in UTC; comments give the local wall-clock times. */
function shift(
  zone: string,
  startUtc: string,
  endUtc: string,
  breakMinutes: number | null,
  hourlyRate = '25.10',
): PayInput {
  return { startAt: startUtc, endAt: endUtc, timeZone: zone, breakMinutes, hourlyRate };
}

describe('computePay: break (rule 3)', () => {
  it('takes 30 minutes when no break was recorded and hours worked are more than 5', () => {
    // Legacy shift 1: 10:45-16:33 Auckland (NZDT), 5h48m worked, rate 38.57.
    // 348 - 30 = 318 min -> 5.25 h; 5.25 * 38.57 = 202.4925 -> 202.49
    const r = computePay(shift(AKL, '2026-03-22T21:45:00Z', '2026-03-23T03:33:00Z', null, '38.57'));
    expect(r).toEqual({ work_date: '2026-03-23', paid_hours: '5.25', gross_pay: '202.49' });
  });

  it('takes no break when no break was recorded and hours worked are exactly 5', () => {
    const r = computePay(shift(BNE, '2026-03-23T00:00:00Z', '2026-03-23T05:00:00Z', null));
    expect(r.paid_hours).toBe('5.00');
    expect(r.gross_pay).toBe('125.50');
  });

  it('takes the 30 minutes as soon as hours worked pass 5 by a minute', () => {
    // 301 - 30 = 271 min -> 4.50 h
    const r = computePay(shift(BNE, '2026-03-23T00:00:00Z', '2026-03-23T05:01:00Z', null));
    expect(r.paid_hours).toBe('4.50');
  });

  it('uses a recorded break of 0 as no break, even on a long shift', () => {
    // Legacy shift 6: 07:22-14:36 Brisbane, BREAKMIN 0 -> 434 min -> 7.25 h
    const r = computePay(shift(BNE, '2026-03-22T21:22:00Z', '2026-03-23T04:36:00Z', 0));
    expect(r.paid_hours).toBe('7.25');
    expect(r.gross_pay).toBe('181.98'); // 7.25 * 25.10 = 181.975 -> half a cent rounds up
  });

  it('uses a recorded break instead of the default', () => {
    // 9h20m worked, 60 min break -> 500 min -> 8.25 h (500 is 5 min past 495)
    const r = computePay(shift(BNE, '2026-03-23T01:15:00Z', '2026-03-23T10:35:00Z', 60, '37.95'));
    expect(r.paid_hours).toBe('8.25');
    expect(r.gross_pay).toBe('313.09'); // 8.25 * 37.95 = 313.0875
  });

  it('uses a recorded break on a short shift too', () => {
    // 3h09m worked, 30 min break -> 159 min; nearer to 165 (2.75 h) than to 150
    const r = computePay(shift(BNE, '2026-03-23T01:30:00Z', '2026-03-23T04:39:00Z', 30));
    expect(r.paid_hours).toBe('2.75');
  });
});

describe('computePay: rounding paid hours to the quarter (rule 4)', () => {
  it('rounds exactly halfway between two quarters up', () => {
    // 4h07m30s -> exactly between 4.00 and 4.25
    const r = computePay(shift(BNE, '2026-03-23T00:00:00Z', '2026-03-23T04:07:30Z', 0));
    expect(r.paid_hours).toBe('4.25');
  });

  it('rounds just under halfway down', () => {
    const r = computePay(shift(BNE, '2026-03-23T00:00:00Z', '2026-03-23T04:07:29Z', 0));
    expect(r.paid_hours).toBe('4.00');
  });

  it('rounds just over a quarter down to it', () => {
    const r = computePay(shift(BNE, '2026-03-23T00:00:00Z', '2026-03-23T04:22:00Z', 0));
    expect(r.paid_hours).toBe('4.25');
  });
});

describe('computePay: gross pay to the cent (rule 5)', () => {
  it('rounds exactly half a cent up', () => {
    // 0.75 * 25.10 = 18.825 -> 18.83
    const r = computePay(shift(BNE, '2026-03-23T00:00:00Z', '2026-03-23T00:45:00Z', 0));
    expect(r.gross_pay).toBe('18.83');
  });

  it('rounds a quarter of a cent down and three quarters up', () => {
    // 0.25 * 25.01 = 6.2525 -> 6.25 ; 0.75 * 25.01 = 18.7575 -> 18.76
    expect(computePay(shift(BNE, '2026-03-23T00:00:00Z', '2026-03-23T00:15:00Z', 0, '25.01')).gross_pay).toBe('6.25');
    expect(computePay(shift(BNE, '2026-03-23T00:00:00Z', '2026-03-23T00:45:00Z', 0, '25.01')).gross_pay).toBe('18.76');
  });

  it('is exact where a float would drift', () => {
    // 8.25 * 35.17 = 290.1525 exactly (as a float product it is not exact)
    const r = computePay(shift(BNE, '2026-03-23T00:00:00Z', '2026-03-23T08:15:00Z', 0, '35.17'));
    expect(r.gross_pay).toBe('290.15');
  });

  it('refuses a rate that is not two-decimal text', () => {
    expect(() => computePay(shift(BNE, '2026-03-23T00:00:00Z', '2026-03-23T01:00:00Z', 0, '25.1'))).toThrow(
      'not a money amount: 25.1',
    );
  });
});

describe('computePay: work date (rule 6)', () => {
  it('is the local date the shift started, not the UTC date', () => {
    // 08:00 on the 24th in Auckland is 19:00 on the 23rd in UTC
    const r = computePay(shift(AKL, '2026-03-23T19:00:00Z', '2026-03-24T01:00:00Z', 0));
    expect(r.work_date).toBe('2026-03-24');
  });

  it('is the start date for an overnight shift', () => {
    // 22:00 on the 23rd to 06:00 on the 24th, Brisbane
    const r = computePay(shift(BNE, '2026-03-23T12:00:00Z', '2026-03-23T20:00:00Z', 30));
    expect(r.work_date).toBe('2026-03-23');
    expect(r.paid_hours).toBe('7.50');
  });
});

describe('computePay: hours worked (rule 2) across a DST change', () => {
  it('counts real elapsed time on the night clocks go back', () => {
    // 2026-04-05 00:00 NZDT (+13) to 06:00 NZST (+12) is 7 hours, not 6
    const r = computePay(shift(AKL, '2026-04-04T11:00:00Z', '2026-04-04T18:00:00Z', null));
    expect(r.work_date).toBe('2026-04-05');
    expect(r.paid_hours).toBe('6.50');
  });
});

describe('isPayable (rule 1)', () => {
  it('pays approved and paid shifts that are not deleted', () => {
    expect(isPayable({ status: 'approved', deleted: false })).toBe(true);
    expect(isPayable({ status: 'paid', deleted: false })).toBe(true);
  });

  it('does not pay drafts or deleted shifts', () => {
    expect(isPayable({ status: 'draft', deleted: false })).toBe(false);
    expect(isPayable({ status: 'approved', deleted: true })).toBe(false);
    expect(isPayable({ status: 'paid', deleted: true })).toBe(false);
  });
});
