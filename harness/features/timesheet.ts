// Timesheet adapter: legacy results (black box), the inputs behind each shift, and the result key.
import type pg from 'pg';
import { legacyResults } from '../lib/legacy-results.ts';
import type { ShiftInputs } from '../lib/types.ts';

/** The legacy screen's function (black box); its id column is key.field. */
export const legacyFn = 'fn_timesheet';
export const legacyRows = (admin: pg.ClientBase) => legacyResults(admin, legacyFn, key.field);

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
