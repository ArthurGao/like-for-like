// Builder-only: pins the legacy function's behaviour on every seeded edge case,
// and proves reset + seed is deterministic. Resets the database.
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminPool, closePools } from '../../platform/db.ts';

const run = (script: string) => execFileSync('npm', ['run', '--silent', script], { stdio: 'pipe' });

async function legacyChecksum(): Promise<string> {
  const { rows } = await adminPool().query<{ md5: string }>(
    `SELECT md5(string_agg(x, E'\\n' ORDER BY x)) AS md5 FROM (
       SELECT t::text AS x FROM legacy."OSUSR_A1B_TENANT" t
       UNION ALL SELECT e::text FROM legacy."OSUSR_A1B_EMPLOYEE" e
       UNION ALL SELECT s::text FROM legacy."OSUSR_A1B_SHIFT" s) all_rows`,
  );
  return rows[0]!.md5;
}

/** Legacy results for shifts with this local start and end, keyed by tenant time zone. */
async function resultsFor(start: string, end: string) {
  const { rows } = await adminPool().query<{ tz: string; work_date: string; paid_hours: string; gross_pay: string; rate: string }>(
    `SELECT t."TIMEZONE" AS tz, f.work_date, f.paid_hours::text, f.gross_pay::text, e."HOURLYRATE"::text AS rate
       FROM legacy."OSUSR_A1B_SHIFT" s
       JOIN legacy."OSUSR_A1B_TENANT" t ON t."ID" = s."TENANTID"
       JOIN legacy."OSUSR_A1B_EMPLOYEE" e ON e."ID" = s."EMPLOYEEID"
       LEFT JOIN legacy.fn_timesheet() f ON f.shift_id = s."ID"
      WHERE s."STARTDATETIME" = $1 AND s."ENDDATETIME" = $2
      ORDER BY s."ID"`,
    [start, end],
  );
  return rows;
}

beforeAll(() => {
  run('db:reset');
  run('seed');
});
afterAll(closePools);

describe('seed', () => {
  it('gives identical data on every reset', async () => {
    const first = await legacyChecksum();
    run('db:reset');
    run('seed');
    expect(await legacyChecksum()).toBe(first);
  });

  it('has roughly 900 to 1,100 shifts', async () => {
    const { rows } = await adminPool().query<{ n: number }>(`SELECT count(*)::int AS n FROM legacy."OSUSR_A1B_SHIFT"`);
    expect(rows[0]!.n).toBeGreaterThanOrEqual(900);
    expect(rows[0]!.n).toBeLessThanOrEqual(1100);
  });
});

describe('legacy.fn_timesheet', () => {
  it('pays real elapsed time across the April clock change (9 h less 30 min break)', async () => {
    const rows = await resultsFor('2026-04-04 22:00:00', '2026-04-05 06:00:00');
    expect(rows.map((r) => [r.tz, r.paid_hours])).toEqual([
      ['Pacific/Auckland', '8.50'],
      ['Pacific/Auckland', '8.50'],
      ['Australia/Brisbane', '7.50'],
      ['Pacific/Fiji', '7.50'],
    ]);
    expect(rows.every((r) => r.work_date === '2026-04-04')).toBe(true);
  });

  it('pays real elapsed time across the September clock change (7 h less 30 min break)', async () => {
    const rows = await resultsFor('2026-09-26 22:00:00', '2026-09-27 06:00:00');
    expect(rows.map((r) => [r.tz, r.paid_hours])).toEqual([
      ['Pacific/Auckland', '6.50'],
      ['Pacific/Auckland', '6.50'],
      ['Australia/Brisbane', '7.50'],
      ['Pacific/Fiji', '7.50'],
    ]);
  });

  it('applies the default break only above 5 hours when none is recorded', async () => {
    expect((await resultsFor('2026-03-25 09:00:00', '2026-03-25 14:00:00')).map((r) => r.paid_hours)).toEqual(['5.00', '5.00', '5.00']);
    // 301 min - 30 = 271 min = 18.07 quarters -> 18 quarters
    expect((await resultsFor('2026-03-26 09:00:00', '2026-03-26 14:01:00')).map((r) => r.paid_hours)).toEqual(['4.50', '4.50', '4.50']);
  });

  it('keeps a recorded zero break', async () => {
    expect((await resultsFor('2026-03-27 07:00:00', '2026-03-27 18:00:00')).map((r) => r.paid_hours)).toEqual(['11.00', '11.00', '11.00']);
  });

  it('rounds to the nearest quarter hour, half up', async () => {
    expect((await resultsFor('2026-09-15 08:00:00', '2026-09-15 15:07:00'))[0]!.paid_hours).toBe('7.00');
    expect((await resultsFor('2026-09-16 08:00:00', '2026-09-16 15:07:30'))[0]!.paid_hours).toBe('7.25');
    expect((await resultsFor('2026-09-17 08:00:00', '2026-09-17 15:08:00'))[0]!.paid_hours).toBe('7.25');
  });

  it('rounds half a cent up', async () => {
    const rows = await resultsFor('2026-09-18 08:00:00', '2026-09-18 15:15:00');
    expect(rows.map((r) => [r.rate, r.paid_hours, r.gross_pay])).toEqual([
      ['25.10', '7.25', '181.98'],
      ['25.10', '7.25', '181.98'],
      ['25.10', '7.25', '181.98'],
    ]);
  });

  it('leaves out draft and deleted shifts but pays an inactive employee', async () => {
    expect((await resultsFor('2026-09-21 09:00:00', '2026-09-21 17:00:00')).map((r) => r.paid_hours)).toEqual([null, null, null]);
    expect((await resultsFor('2026-09-22 09:00:00', '2026-09-22 17:00:00')).map((r) => r.paid_hours)).toEqual([null, null, null]);
    expect((await resultsFor('2026-03-24 10:00:00', '2026-03-24 16:30:00')).map((r) => r.paid_hours)).toEqual(['6.00', '6.00', '6.00']);
  });
});
