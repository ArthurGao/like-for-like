// Builder-only: pins the legacy clock-events function on every seeded edge case.
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminPool, closePools } from '../../platform/db.ts';

const run = (script: string) => execFileSync('npm', ['run', '--silent', script], { stdio: 'pipe' });

/** Legacy result for each clock-in at this local time, with its tenant's zone. */
async function paidFor(clockIn: string) {
  const { rows } = await adminPool().query<{ tz: string; paid_hours: string | null; work_date: string | null }>(
    `SELECT t."TIMEZONE" AS tz, f.paid_hours::text, f.work_date
       FROM legacy."OSUSR_A1B_CLOCKEVENT" c
       JOIN legacy."OSUSR_A1B_TENANT" t ON t."ID" = c."TENANTID"
       LEFT JOIN legacy.fn_clock_timesheet() f ON f.clock_in_id = c."ID"
      WHERE c."EVENTDATETIME" = $1 AND c."EVENTTYPE" = 1
      ORDER BY t."ID"`,
    [clockIn],
  );
  return rows;
}

beforeAll(() => {
  run('db:reset');
  run('seed');
});
afterAll(closePools);

describe('legacy.fn_clock_timesheet', () => {
  it('pays real elapsed time across both Auckland clock changes', async () => {
    expect((await paidFor('2026-04-04 22:00:07')).map((r) => [r.tz, r.paid_hours, r.work_date])).toEqual([
      ['Pacific/Auckland', '8.50', '2026-04-04'],
      ['Australia/Brisbane', '7.50', '2026-04-04'],
      ['Pacific/Fiji', '7.50', '2026-04-04'],
    ]);
    expect((await paidFor('2026-09-26 22:00:07')).map((r) => r.paid_hours)).toEqual(['6.50', '7.50', '7.50']);
  });

  it('reads a repeated local time as the later instant (22:00 to 02:30 is 5 h 30 less the break)', async () => {
    expect((await paidFor('2026-04-04 22:00:00')).map((r) => r.paid_hours)).toEqual(['5.00']);
  });

  it('drops seconds before computing (08:00:59 to 15:08:10 pays as 08:00 to 15:08)', async () => {
    expect((await paidFor('2026-09-23 08:00:59')).map((r) => r.paid_hours)).toEqual(['6.75', '6.75', '6.75']);
  });

  it('pays only a clock-in followed by a clock-out, ignoring deleted events', async () => {
    const { rows } = await adminPool().query<{ open: number; paid: number; ins: number }>(
      `SELECT (SELECT count(*) FROM legacy."OSUSR_A1B_CLOCKEVENT" WHERE "EVENTTYPE" = 1 AND "IS_ACTIVE")::int AS ins,
              (SELECT count(*) FROM legacy.fn_clock_timesheet())::int AS paid,
              (SELECT count(*) FROM legacy."OSUSR_A1B_CLOCKEVENT" c WHERE "EVENTTYPE" = 1 AND "IS_ACTIVE"
                 AND NOT EXISTS (SELECT 1 FROM legacy.fn_clock_timesheet() f WHERE f.clock_in_id = c."ID"))::int AS open`,
    );
    expect(rows[0]!.open).toBeGreaterThan(0);
    expect(rows[0]!.paid + rows[0]!.open).toBe(rows[0]!.ins);
  });
});
