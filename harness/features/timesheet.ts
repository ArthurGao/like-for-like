// Timesheet adapter: legacy results (black box), the inputs behind each shift, and the result key.
import type pg from 'pg';
import type { CompareRow, ShiftInputs } from '../lib/types.ts';

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

/** The new result's id field and the migration.id_map entity it maps back through. */
export const key = { field: 'shift_id', entity: 'shift' } as const;
