// Clock-events adapter: legacy results (black box), the inputs behind each clock-in, the key.
import type pg from 'pg';
import type { CompareRow, ShiftInputs } from '../lib/types.ts';

export async function legacyRows(admin: pg.ClientBase): Promise<CompareRow[]> {
  const { rows } = await admin.query<CompareRow>(
    `SELECT f.clock_in_id AS "legacyShiftId", t."NAME" AS tenant, f.employee_id AS "employeeId",
            e."FULLNAME" AS employee, f.work_date, f.paid_hours::text, f.gross_pay::text
       FROM legacy.fn_clock_timesheet() f
       JOIN legacy."OSUSR_A1B_TENANT" t ON t."ID" = f.tenant_id
       JOIN legacy."OSUSR_A1B_EMPLOYEE" e ON e."ID" = f.employee_id`,
  );
  return rows;
}

/** Keyed by clock-in id; the end is the employee's next event in time (whatever its type). */
export async function shiftInputs(admin: pg.ClientBase): Promise<Map<number, ShiftInputs>> {
  const { rows } = await admin.query<ShiftInputs & { id: number }>(
    `SELECT c.id, t."NAME" AS tenant, t."TIMEZONE" AS "timeZone", e."ID" AS "employeeId", e."FULLNAME" AS employee,
            e."HOURLYRATE"::text AS rate, c.at AS "startLocal", coalesce(c.next_at, '') AS "endLocal",
            NULL::int AS "breakMin", c.typ AS status, c.active
       FROM (SELECT "ID" AS id, "TENANTID" AS tenant_id, "EMPLOYEEID" AS employee_id, "EVENTTYPE" AS typ,
                    "IS_ACTIVE" AS active, "EVENTDATETIME"::text AS at,
                    lead("EVENTDATETIME"::text) OVER (PARTITION BY "EMPLOYEEID", "IS_ACTIVE" ORDER BY "EVENTDATETIME", "ID") AS next_at
               FROM legacy."OSUSR_A1B_CLOCKEVENT") c
       JOIN legacy."OSUSR_A1B_TENANT" t ON t."ID" = c.tenant_id
       JOIN legacy."OSUSR_A1B_EMPLOYEE" e ON e."ID" = c.employee_id
      WHERE c.typ = 1`,
  );
  return new Map(rows.map(({ id, ...rest }) => [id, rest]));
}

export const key = { field: 'clock_in_id', entity: 'clock_event' } as const;
