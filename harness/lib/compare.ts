import { compareRecords } from '../checks/records.ts';
import { compareTenantTotals, compareWeekTotals } from '../checks/totals.ts';
import type { CompareRow, ShiftInputs } from './types.ts';

/** Checks 2 and 3 on two result sets: totals per tenant, per employee-week, and per record. */
export function compareResults(
  tenants: readonly string[],
  legacy: readonly CompareRow[],
  fresh: readonly CompareRow[],
  inputs: ReadonlyMap<number, ShiftInputs>,
) {
  const weeks = compareWeekTotals(legacy, fresh);
  const differing = weeks.filter((w) => !w.ok);
  return {
    totals: compareTenantTotals(tenants, legacy, fresh),
    weeklyTotals: { groups: weeks.length, differing: differing.length, rows: differing },
    ...compareRecords(legacy, fresh, inputs),
  };
}
