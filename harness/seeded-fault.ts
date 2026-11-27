// Seeded-fault check: proves the harness catches a wrong calculation.
// SEEDED ON PURPOSE. The "new" results below take elapsed time as the plain difference of
// the two local wall-clock timestamps, ignoring the tenant's time zone. Every other rule is
// implemented correctly, so the only differences are on nights when the clocks change.
// Read access is denied to the migration agent.
import { DateTime } from 'luxon';
import { runMain } from '../platform/cli.ts';
import { adminPool } from '../platform/db.ts';
import * as timesheet from './features/timesheet.ts';
import { compareResults } from './lib/compare.ts';
import { format, parse } from './lib/decimal.ts';
import { writeReport } from './lib/runs.ts';
import type { CompareRow, NamedCheck, ShiftInputs } from './lib/types.ts';

const DST_TENANT = 'Harbour Kitchen Group';
const CONTROL_TENANT = 'Sunline Hotels';
const CHANGE_NIGHTS = ['2026-04-04', '2026-09-26'];

/** Half-up division for non-negative integers. */
const divHalfUp = (n: bigint, d: bigint) => (2n * n + d) / (2n * d);
const CENT = parse('0.01');

/** The deliberately wrong calculation, on legacy ids. Pure, so it can be unit-tested. */
export function wrongCalc(shifts: ReadonlyMap<number, ShiftInputs>): CompareRow[] {
  return [...shifts]
    .filter(([, s]) => s.active && (s.status === 2 || s.status === 3))
    .map(([id, s]) => {
      const wall = (v: string) => DateTime.fromSQL(v, { zone: 'UTC' });
      const elapsedSec = BigInt(Math.round(wall(s.endLocal).diff(wall(s.startLocal), 'seconds').seconds));
      const breakSec = BigInt(60 * (s.breakMin ?? (elapsedSec > 300n * 60n ? 30 : 0)));
      const quarters = divHalfUp(elapsedSec - breakSec, 900n);
      const grossCents = divHalfUp(quarters * (parse(s.rate) / CENT), 4n);
      return {
        legacyShiftId: id,
        tenant: s.tenant,
        employeeId: s.employeeId,
        employee: s.employee,
        work_date: s.startLocal.slice(0, 10),
        paid_hours: format(quarters * parse('0.25')),
        gross_pay: format(grossCents * CENT),
      };
    });
}

// Run only when executed directly (the unit test imports wrongCalc).
if (import.meta.url === `file://${process.argv[1]}`) runMain(async () => {
  const startedAt = new Date().toISOString();
  const admin = await adminPool().connect();
  try {
    const inputs = await timesheet.shiftInputs(admin);
    const legacy = await timesheet.legacyRows(admin);
    const tenants = await timesheet.tenantNames(admin);
    const { totals, weeklyTotals, compared, mismatches } = compareResults(tenants, legacy, wrongCalc(inputs), inputs);

    const changeNightShifts = [...inputs].filter(
      ([, s]) => s.tenant === DST_TENANT && CHANGE_NIGHTS.includes(s.startLocal.slice(0, 10)) &&
        s.endLocal.slice(0, 10) !== s.startLocal.slice(0, 10) && s.active && s.status !== 1,
    ).map(([id]) => id);
    const mismatchIds = new Set(mismatches.map((m) => m.legacyShiftId));
    const assertions: NamedCheck[] = [
      { name: 'harness reports at least one mismatch', ok: mismatches.length > 0, detail: `${mismatches.length}` },
      {
        name: 'every mismatch is an overnight shift on a clock-change night in the Auckland tenant',
        ok: mismatches.every((m) => changeNightShifts.includes(m.legacyShiftId)),
      },
      {
        name: 'every overnight shift on a clock-change night in the Auckland tenant is caught',
        ok: changeNightShifts.length > 0 && changeNightShifts.every((id) => mismatchIds.has(id)),
        detail: `${changeNightShifts.length} shifts`,
      },
      { name: 'no mismatch in the Brisbane control tenant', ok: !mismatches.some((m) => m.tenant === CONTROL_TENANT) },
      { name: 'Brisbane control tenant totals match', ok: totals.find((t) => t.tenant === CONTROL_TENANT)?.ok === true },
    ];
    const ok = assertions.every((a) => a.ok);
    const report = {
      seeded: true,
      label: 'Seeded fault: we broke it on purpose',
      fault: 'Elapsed time taken as the plain difference of the two local timestamps.',
      startedAt,
      finishedAt: new Date().toISOString(),
      summary: { recordsCompared: compared, mismatches: mismatches.length, assertionsPassed: ok },
      assertions,
      totals,
      weeklyTotals,
      mismatches,
    };
    for (const a of assertions) console.log(`${a.ok ? 'PASS' : 'FAIL'}  ${a.name}${a.detail ? ` (${a.detail})` : ''}`);
    console.log(`report: ${await writeReport('seeded', report)}`);
    return ok ? 0 : 1;
  } finally {
    admin.release();
  }
});
