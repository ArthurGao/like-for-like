// What the harness expects from a migrated feature in features/<name>/.
import type pg from 'pg';
import type { VerifiedClaims } from '../platform/auth.ts';

/** One row per payable shift, the same shape as the legacy result. */
export type TimesheetRow = {
  shift_id: string; // new uuid
  tenant_id: string; // new uuid
  employee_id: string; // new uuid
  work_date: string; // YYYY-MM-DD
  paid_hours: string; // decimal as text, e.g. "7.25"
  gross_pay: string; // decimal as text, e.g. "181.98"
};

/** clock-events: one row per clock-in that has a matching clock-out, keyed by that clock-in. */
export type ClockShiftRow = Omit<TimesheetRow, 'shift_id'> & {
  clock_in_id: string; // new uuid of the clock-in event
};

/** features/<name>/migrate.ts must export `migrate`. The pool connects as the migrator role. */
export type MigrateFn = (pool: pg.Pool) => Promise<void>;

/**
 * features/<name>/calc.ts must export `calculate`. The client is already inside withTenant for
 * the tenant in `claims`, so it sees that tenant only. Return every payable row of that tenant:
 * TimesheetRow for timesheet, ClockShiftRow for clock-events.
 */
export type CalculateFn<R = TimesheetRow> = (client: pg.PoolClient, claims: VerifiedClaims) => Promise<R[]>;
