import type pg from 'pg';
import type { CompareRow } from './types.ts';

/** A legacy screen's function (black box): its rows with tenant and employee names. */
export async function legacyResults(admin: pg.ClientBase, fn: string, idColumn: string): Promise<CompareRow[]> {
  const { rows } = await admin.query<CompareRow>(
    `SELECT f.${idColumn} AS "legacyShiftId", t."NAME" AS tenant, f.employee_id AS "employeeId",
            e."FULLNAME" AS employee, f.work_date, f.paid_hours::text, f.gross_pay::text
       FROM legacy.${fn}() f
       JOIN legacy."OSUSR_A1B_TENANT" t ON t."ID" = f.tenant_id
       JOIN legacy."OSUSR_A1B_EMPLOYEE" e ON e."ID" = f.employee_id`,
  );
  return rows;
}
