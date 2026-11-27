// Clock-events migration: all legacy clock events (deleted ones too) -> app.clock_event, plus
// migration.id_map. Tenants and employees come from the timesheet migration, which runs first.
// Runs as the migrator role (BYPASSRLS) in one transaction. Ids are UUIDv5 of entity + legacy id
// and every write is an upsert that skips unchanged rows, so a second run changes nothing.
import type pg from 'pg';
import type { MigrateFn } from '../../harness/contracts.ts';
import { localToInstant, newId } from '../timesheet/migrate.ts';
import type { ClockEventType } from './calc.ts';

const EVENT_TYPE: Record<number, ClockEventType> = { 1: 'in', 2: 'out' };

export function eventType(code: number): ClockEventType {
  const t = EVENT_TYPE[code];
  if (!t) throw new Error(`unknown legacy clock event type: ${code}`);
  return t;
}

export type LegacyClockEvent = {
  id: number;
  tenant_id: number;
  employee_id: number;
  event_type: number;
  local_at: string;
  active: boolean;
};

/** One legacy event -> its app.clock_event values; a bad reference fails naming the event. */
export function clockEventRow(
  c: LegacyClockEvent,
  zoneOfTenant: ReadonlyMap<number, string>,
  tenantOfEmployee: ReadonlyMap<number, number>,
) {
  try {
    const empTenant = tenantOfEmployee.get(c.employee_id);
    if (empTenant === undefined) throw new Error(`unknown employee ${c.employee_id}`);
    if (empTenant !== c.tenant_id) throw new Error(`tenant ${c.tenant_id} differs from employee tenant ${empTenant}`);
    const zone = zoneOfTenant.get(c.tenant_id);
    if (zone === undefined) throw new Error(`unknown tenant ${c.tenant_id}`);
    return {
      legacy_id: c.id,
      id: newId('clock_event', c.id),
      tenant_id: newId('tenant', c.tenant_id),
      employee_id: newId('employee', c.employee_id),
      event_type: eventType(c.event_type),
      occurred_at: localToInstant(c.local_at, zone),
      active: c.active,
    };
  } catch (err) {
    throw new Error(`clock event ${c.id}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

export const migrate: MigrateFn = async (pool: pg.Pool) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tenants = (
      await client.query<{ id: number; time_zone: string }>(
        `SELECT "ID" AS id, "TIMEZONE" AS time_zone FROM legacy."OSUSR_A1B_TENANT"`,
      )
    ).rows;
    const employees = (
      await client.query<{ id: number; tenant_id: number }>(
        `SELECT "ID" AS id, "TENANTID" AS tenant_id FROM legacy."OSUSR_A1B_EMPLOYEE"`,
      )
    ).rows;
    const events = (
      await client.query<LegacyClockEvent>(
        `SELECT "ID" AS id, "TENANTID" AS tenant_id, "EMPLOYEEID" AS employee_id, "EVENTTYPE" AS event_type,
                "EVENTDATETIME"::text AS local_at, "IS_ACTIVE" AS active
           FROM legacy."OSUSR_A1B_CLOCKEVENT" ORDER BY "ID"`,
      )
    ).rows;

    // A bad zone fails in localToInstant, naming the event (the timesheet migration also checks it).
    const zoneOfTenant = new Map(tenants.map((t) => [t.id, t.time_zone]));
    const tenantOfEmployee = new Map(employees.map((e) => [e.id, e.tenant_id]));
    const rows = events.map((c) => clockEventRow(c, zoneOfTenant, tenantOfEmployee));

    // deleted_at: legacy keeps no deletion time, so a deleted event gets the time of the first
    // run that saw it deleted; later runs keep that value.
    await client.query(
      `INSERT INTO app.clock_event (id, tenant_id, employee_id, event_type, occurred_at, deleted_at)
       SELECT u.id, u.tenant_id, u.employee_id, u.event_type, u.occurred_at,
              CASE WHEN u.active THEN NULL ELSE now() END
         FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::app.clock_event_type[], $5::timestamptz[], $6::boolean[])
              AS u(id, tenant_id, employee_id, event_type, occurred_at, active)
       ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, employee_id = EXCLUDED.employee_id,
              event_type = EXCLUDED.event_type, occurred_at = EXCLUDED.occurred_at,
              deleted_at = CASE WHEN EXCLUDED.deleted_at IS NULL THEN NULL
                                ELSE COALESCE(app.clock_event.deleted_at, EXCLUDED.deleted_at) END
        WHERE (app.clock_event.tenant_id, app.clock_event.employee_id, app.clock_event.event_type,
               app.clock_event.occurred_at, app.clock_event.deleted_at IS NULL)
              IS DISTINCT FROM
              (EXCLUDED.tenant_id, EXCLUDED.employee_id, EXCLUDED.event_type,
               EXCLUDED.occurred_at, EXCLUDED.deleted_at IS NULL)`,
      [
        rows.map((r) => r.id),
        rows.map((r) => r.tenant_id),
        rows.map((r) => r.employee_id),
        rows.map((r) => r.event_type),
        rows.map((r) => r.occurred_at),
        rows.map((r) => r.active),
      ],
    );

    await client.query(
      `INSERT INTO migration.id_map (entity, legacy_id, new_id, tenant_id)
       SELECT 'clock_event', * FROM unnest($1::integer[], $2::uuid[], $3::uuid[])
       ON CONFLICT (entity, legacy_id) DO UPDATE SET new_id = EXCLUDED.new_id, tenant_id = EXCLUDED.tenant_id
        WHERE (migration.id_map.new_id, migration.id_map.tenant_id) IS DISTINCT FROM (EXCLUDED.new_id, EXCLUDED.tenant_id)`,
      [rows.map((r) => r.legacy_id), rows.map((r) => r.id), rows.map((r) => r.tenant_id)],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
};
