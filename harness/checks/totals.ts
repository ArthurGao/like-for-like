import { DateTime } from 'luxon';
import { equal, sum } from '../lib/decimal.ts';
import type { CompareRow } from '../lib/types.ts';

export type TenantTotal = {
  tenant: string;
  legacyHours: string;
  newHours: string;
  legacyGross: string;
  newGross: string;
  ok: boolean;
};

export type WeekTotal = TenantTotal & { employee: string; weekStart: string };

/** Monday of the week the work date falls in (calendar arithmetic, no time zone involved). */
export const weekStart = (workDate: string) =>
  DateTime.fromISO(workDate, { zone: 'UTC' }).startOf('week').toISODate()!;

function group<K>(rows: readonly CompareRow[], key: (r: CompareRow) => K) {
  const m = new Map<K, CompareRow[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

const totalsOf = (legacy: readonly CompareRow[] = [], fresh: readonly CompareRow[] = []) => {
  const t = {
    legacyHours: sum(legacy.map((r) => r.paid_hours)),
    newHours: sum(fresh.map((r) => r.paid_hours)),
    legacyGross: sum(legacy.map((r) => r.gross_pay)),
    newGross: sum(fresh.map((r) => r.gross_pay)),
  };
  return { ...t, ok: equal(t.legacyHours, t.newHours) && equal(t.legacyGross, t.newGross) };
};

export function compareTenantTotals(
  tenants: readonly string[],
  legacy: readonly CompareRow[],
  fresh: readonly CompareRow[],
): TenantTotal[] {
  const l = group(legacy, (r) => r.tenant);
  const n = group(fresh, (r) => r.tenant);
  return tenants.map((tenant) => ({ tenant, ...totalsOf(l.get(tenant), n.get(tenant)) }));
}

/** Per employee per week (Monday start, by work date). Returns every group, sorted. */
export function compareWeekTotals(
  legacy: readonly CompareRow[],
  fresh: readonly CompareRow[],
): WeekTotal[] {
  const key = (r: CompareRow) => `${r.tenant}\u0000${r.employeeId}\u0000${weekStart(r.work_date)}`;
  const l = group(legacy, key);
  const n = group(fresh, key);
  const keys = [...new Set([...l.keys(), ...n.keys()])].sort();
  return keys.map((k) => {
    const s = (l.get(k) ?? n.get(k))![0]!;
    return { tenant: s.tenant, employee: s.employee, weekStart: weekStart(s.work_date), ...totalsOf(l.get(k), n.get(k)) };
  });
}
