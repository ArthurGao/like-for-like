// Run a feature's calculation once per migrated tenant, as that tenant, and key its rows by
// legacy ids through migration.id_map.
import type pg from 'pg';
import { signToken, verifyToken } from '../../platform/auth.ts';
import { withTenant } from '../../platform/db.ts';
import type { CalculateFn } from '../contracts.ts';
import { isDecimalText } from './decimal.ts';
import type { CompareRow } from './types.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The result field holding the new record id, and the id_map entity it maps back through. */
export type ResultKey = { field: string; entity: string };
type Row = Record<string, unknown>;

function shapeError(r: Row, idField: string): string | null {
  for (const k of [idField, 'tenant_id', 'employee_id']) {
    if (typeof r[k] !== 'string') return `${k} must be a string`;
  }
  if (typeof r.work_date !== 'string' || !DATE_RE.test(r.work_date)) return 'work_date must be YYYY-MM-DD text';
  if (!isDecimalText(r.paid_hours)) return 'paid_hours must be decimal text';
  if (!isDecimalText(r.gross_pay)) return 'gross_pay must be decimal text';
  return null;
}

/** Problems (bad shape, unmapped ids, wrong tenant) are returned, not thrown. */
export async function newRows(
  admin: pg.ClientBase,
  calculate: CalculateFn<Row>,
  key: ResultKey,
): Promise<{ rows: CompareRow[]; errors: string[] }> {
  const { rows: map } = await admin.query<{ entity: string; legacy_id: number; new_id: string }>(
    'SELECT entity, legacy_id, new_id::text FROM migration.id_map',
  );
  const legacyId = new Map(map.map((m) => [`${m.entity}:${m.new_id}`, m.legacy_id]));
  const { rows: tenants } = await admin.query<{ id: number; name: string }>(`SELECT "ID" AS id, "NAME" AS name FROM legacy."OSUSR_A1B_TENANT"`);
  const { rows: employees } = await admin.query<{ id: number; name: string }>(`SELECT "ID" AS id, "FULLNAME" AS name FROM legacy."OSUSR_A1B_EMPLOYEE"`);
  const tenantName = new Map(tenants.map((t) => [t.id, t.name]));
  const employeeName = new Map(employees.map((e) => [e.id, e.name]));

  const rows: CompareRow[] = [];
  const errors: string[] = [];
  for (const m of map.filter((x) => x.entity === 'tenant')) {
    const claims = await verifyToken(await signToken({ sub: `harness-${m.legacy_id}`, tenantId: m.new_id }));
    let result: Row[];
    try {
      result = await withTenant(claims, (client) => calculate(client, claims));
    } catch (err) {
      errors.push(`calculate() for tenant ${m.legacy_id} threw: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (!Array.isArray(result)) {
      errors.push(`calculate() for tenant ${m.legacy_id} did not return an array`);
      continue;
    }
    for (const r of result) {
      const id = String(r[key.field]);
      const problem = shapeError(r, key.field);
      const recordId = legacyId.get(`${key.entity}:${id}`);
      const employeeId = legacyId.get(`employee:${r.employee_id}`);
      if (problem) errors.push(`${key.field} ${id}: ${problem}`);
      else if (r.tenant_id !== m.new_id) errors.push(`${key.field} ${id}: tenant_id ${r.tenant_id} outside tenant context`);
      else if (recordId === undefined || employeeId === undefined) errors.push(`${key.field} ${id}: id not in migration.id_map`);
      else {
        rows.push({
          legacyShiftId: recordId,
          tenant: tenantName.get(m.legacy_id) ?? `(tenant ${m.legacy_id})`,
          employeeId,
          employee: employeeName.get(employeeId) ?? `(employee ${employeeId})`,
          work_date: r.work_date as string,
          paid_hours: r.paid_hours as string,
          gross_pay: r.gross_pay as string,
        });
      }
    }
  }
  if (map.every((x) => x.entity !== 'tenant')) errors.push('no tenants in migration.id_map');
  return { rows, errors };
}
