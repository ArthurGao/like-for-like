// Timesheet adapter: legacy results (black box), new results (through withTenant), inputs.
import type pg from 'pg';
import { signToken, verifyToken } from '../../platform/auth.ts';
import { withTenant } from '../../platform/db.ts';
import type { CalculateFn, TimesheetRow } from '../contracts.ts';
import { isDecimalText } from '../lib/decimal.ts';
import type { CompareRow, ShiftInputs } from '../lib/types.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function tenantNames(admin: pg.ClientBase): Promise<string[]> {
  const { rows } = await admin.query<{ name: string }>(`SELECT "NAME" AS name FROM legacy."OSUSR_A1B_TENANT" ORDER BY "ID"`);
  return rows.map((r) => r.name);
}

export async function legacyRows(admin: pg.ClientBase): Promise<CompareRow[]> {
  const { rows } = await admin.query<CompareRow>(
    `SELECT f.shift_id AS "legacyShiftId", t."NAME" AS tenant, f.employee_id AS "employeeId",
            e."FULLNAME" AS employee, f.work_date, f.paid_hours::text, f.gross_pay::text
       FROM legacy.fn_timesheet() f
       JOIN legacy."OSUSR_A1B_TENANT" t ON t."ID" = f.tenant_id
       JOIN legacy."OSUSR_A1B_EMPLOYEE" e ON e."ID" = f.employee_id`,
  );
  return rows;
}

export async function shiftInputs(admin: pg.ClientBase): Promise<Map<number, ShiftInputs>> {
  const { rows } = await admin.query<ShiftInputs & { id: number }>(
    `SELECT s."ID" AS id, t."NAME" AS tenant, t."TIMEZONE" AS "timeZone", e."ID" AS "employeeId", e."FULLNAME" AS employee,
            e."HOURLYRATE"::text AS rate, s."STARTDATETIME" AS "startLocal", s."ENDDATETIME" AS "endLocal",
            s."BREAKMIN" AS "breakMin", s."STATUS" AS status, s."IS_ACTIVE" AS active
       FROM legacy."OSUSR_A1B_SHIFT" s
       JOIN legacy."OSUSR_A1B_TENANT" t ON t."ID" = s."TENANTID"
       JOIN legacy."OSUSR_A1B_EMPLOYEE" e ON e."ID" = s."EMPLOYEEID"`,
  );
  return new Map(rows.map(({ id, ...rest }) => [id, rest]));
}

function shapeError(r: TimesheetRow): string | null {
  for (const k of ['shift_id', 'tenant_id', 'employee_id'] as const) {
    if (typeof r[k] !== 'string') return `${k} must be a string`;
  }
  if (typeof r.work_date !== 'string' || !DATE_RE.test(r.work_date)) return 'work_date must be YYYY-MM-DD text';
  if (!isDecimalText(r.paid_hours)) return 'paid_hours must be decimal text';
  if (!isDecimalText(r.gross_pay)) return 'gross_pay must be decimal text';
  return null;
}

/**
 * Run the new calculation once per migrated tenant, as that tenant, and key the rows by legacy
 * ids through migration.id_map. Problems (bad shape, unmapped ids, wrong tenant) are returned.
 */
export async function newRows(
  admin: pg.ClientBase,
  calculate: CalculateFn,
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
    const result = await withTenant(claims, (client) => calculate(client, claims));
    if (!Array.isArray(result)) {
      errors.push(`calculate() for tenant ${m.legacy_id} did not return an array`);
      continue;
    }
    for (const r of result) {
      const problem = shapeError(r);
      const shiftId = legacyId.get(`shift:${r.shift_id}`);
      const employeeId = legacyId.get(`employee:${r.employee_id}`);
      if (problem) errors.push(`shift ${r.shift_id}: ${problem}`);
      else if (r.tenant_id !== m.new_id) errors.push(`shift ${r.shift_id}: tenant_id ${r.tenant_id} outside tenant context`);
      else if (shiftId === undefined || employeeId === undefined) errors.push(`shift ${r.shift_id}: id not in migration.id_map`);
      else {
        rows.push({
          legacyShiftId: shiftId,
          tenant: tenantName.get(m.legacy_id) ?? `(tenant ${m.legacy_id})`,
          employeeId,
          employee: employeeName.get(employeeId) ?? `(employee ${employeeId})`,
          work_date: r.work_date,
          paid_hours: r.paid_hours,
          gross_pay: r.gross_pay,
        });
      }
    }
  }
  if (map.every((x) => x.entity !== 'tenant')) errors.push('no tenants in migration.id_map');
  return { rows, errors };
}
