import { equal } from '../lib/decimal.ts';
import type { AppliedTriage } from '../lib/triage.ts';
import type { CompareRow, ShiftInputs } from '../lib/types.ts';

export const COMPARED_FIELDS = ['work_date', 'paid_hours', 'gross_pay'] as const;

export type Mismatch = {
  legacyShiftId: number;
  tenant: string;
  employee: string;
  startLocal: string;
  endLocal: string;
  inputs: ShiftInputs | null;
  /** A compared field, or "row" when one side has no row for this shift. */
  field: (typeof COMPARED_FIELDS)[number] | 'row';
  legacy: string;
  new: string;
  triage: AppliedTriage | null;
};

const same = (field: (typeof COMPARED_FIELDS)[number], a: string, b: string) =>
  field === 'work_date' ? a === b : equal(a, b);

/** Join legacy and new rows on the legacy shift id and list every difference. */
export function compareRecords(
  legacy: readonly CompareRow[],
  fresh: readonly CompareRow[],
  inputs: ReadonlyMap<number, ShiftInputs>,
): { compared: number; mismatches: Mismatch[] } {
  const byId = (rows: readonly CompareRow[]) => new Map(rows.map((r) => [r.legacyShiftId, r]));
  const l = byId(legacy);
  const n = byId(fresh);
  const ids = [...new Set([...l.keys(), ...n.keys()])].sort((a, b) => a - b);
  const mismatches: Mismatch[] = [];
  let compared = 0;

  for (const id of ids) {
    const a = l.get(id);
    const b = n.get(id);
    const input = inputs.get(id) ?? null;
    const base = {
      legacyShiftId: id,
      tenant: (a ?? b)!.tenant,
      employee: (a ?? b)!.employee,
      startLocal: input?.startLocal ?? '',
      endLocal: input?.endLocal ?? '',
      inputs: input,
      triage: null,
    };
    if (!a || !b) {
      mismatches.push({ ...base, field: 'row', legacy: a ? 'present' : 'absent', new: b ? 'present' : 'absent' });
      continue;
    }
    compared++;
    for (const field of COMPARED_FIELDS) {
      if (!same(field, a[field], b[field])) {
        mismatches.push({ ...base, field, legacy: a[field], new: b[field] });
      }
    }
  }
  return { compared, mismatches };
}
