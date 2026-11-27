// Timesheet migration: legacy tenants, employees and all shifts -> app.*, plus migration.id_map.
// Runs as the migrator role (BYPASSRLS) in one transaction. Ids are UUIDv5 of entity + legacy id
// and every write is an upsert that skips unchanged rows, so a second run changes nothing.
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { DateTime, IANAZone } from 'luxon';
import type { MigrateFn } from '../../harness/contracts.ts';
import type { ShiftStatus } from './calc.ts';

/** Fixed namespace for like-for-like legacy ids. Never change it: ids are derived from it. */
const NAMESPACE = '6f1c3b0e-8d2a-4c5e-9b7a-2e4d6f8a1c3b';

type Entity ='tenant' | 'employee' | 'shift' | 'clock_event';

/** RFC 4122 version 5 (SHA-1, name-based) uuid. */
export function uuidv5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const b = createHash('sha1').update(ns).update(name, 'utf8').digest().subarray(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const newId = (entity: Entity, legacyId: number) => uuidv5(`${entity}:${legacyId}`, NAMESPACE);

const STATUS: Record<number, ShiftStatus> = { 1: 'draft', 2: 'approved', 3: 'paid' };

export function shiftStatus(code: number): ShiftStatus {
  const s = STATUS[code];
  if (!s) throw new Error(`unknown legacy shift status: ${code}`);
  return s;
}

/**
 * Legacy wall-clock text ("2026-03-23 10:45:00") in an IANA zone -> ISO instant in UTC.
 * A repeated local time (DST ends) is read as the earlier instant; a skipped local time
 * (DST starts) is moved forward by the gap.
 */
export function localToInstant(local: string, zone: string): string {
  if (!IANAZone.isValidZone(zone)) throw new Error(`unknown time zone: ${zone}`);
  const dt = DateTime.fromSQL(local, { zone });
  if (!dt.isValid) throw new Error(`not a legacy timestamp: ${local}`);
  const earliest = dt.getPossibleOffsets().reduce((a, b) => (b.toMillis() < a.toMillis() ? b : a), dt);
  return earliest.toUTC().toISO()!;
}

type LegacyTenant = { id: number; name: string; time_zone: string };
type LegacyEmployee = { id: number; tenant_id: number; full_name: string; hourly_rate: string; active: boolean };
type LegacyShift = {
  id: number;
  tenant_id: number;
  employee_id: number;
  start_local: string;
  end_local: string;
  break_minutes: number | null;
  status: number;
  active: boolean;
};

export const migrate: MigrateFn = async (pool: pg.Pool) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tenants = (
      await client.query<LegacyTenant>(
        `SELECT "ID" AS id, "NAME" AS name, "TIMEZONE" AS time_zone FROM legacy."OSUSR_A1B_TENANT" ORDER BY "ID"`,
      )
    ).rows;
    const employees = (
      await client.query<LegacyEmployee>(
        `SELECT "ID" AS id, "TENANTID" AS tenant_id, "FULLNAME" AS full_name,
                "HOURLYRATE"::text AS hourly_rate, "IS_ACTIVE" AS active
           FROM legacy."OSUSR_A1B_EMPLOYEE" ORDER BY "ID"`,
      )
    ).rows;
    const shifts = (
      await client.query<LegacyShift>(
        `SELECT "ID" AS id, "TENANTID" AS tenant_id, "EMPLOYEEID" AS employee_id,
                "STARTDATETIME"::text AS start_local, "ENDDATETIME"::text AS end_local,
                "BREAKMIN" AS break_minutes, "STATUS" AS status, "IS_ACTIVE" AS active
           FROM legacy."OSUSR_A1B_SHIFT" ORDER BY "ID"`,
      )
    ).rows;

    const tenantIds = tenants.map((t) => newId('tenant', t.id));
    const employeeIds = employees.map((e) => newId('employee', e.id));
    const employeeTenantIds = employees.map((e) => newId('tenant', e.tenant_id));
    const zoneOf = new Map(tenants.map((t) => [t.id, t.time_zone]));
    const tenantOfEmployee = new Map(employees.map((e) => [e.id, e.tenant_id]));
    for (const t of tenants) {
      if (!IANAZone.isValidZone(t.time_zone)) throw new Error(`tenant ${t.id}: unknown time zone ${t.time_zone}`);
    }
    for (const e of employees) {
      if (!zoneOf.has(e.tenant_id)) throw new Error(`employee ${e.id}: unknown tenant ${e.tenant_id}`);
    }

    const shiftRows = shifts.map((s) => {
      const empTenant = tenantOfEmployee.get(s.employee_id);
      if (empTenant === undefined) throw new Error(`shift ${s.id}: unknown employee ${s.employee_id}`);
      if (empTenant !== s.tenant_id) {
        throw new Error(`shift ${s.id}: tenant ${s.tenant_id} differs from employee tenant ${empTenant}`);
      }
      const zone = zoneOf.get(s.tenant_id)!;
      return {
        legacy_id: s.id,
        id: newId('shift', s.id),
        tenant_id: newId('tenant', s.tenant_id),
        employee_id: newId('employee', s.employee_id),
        start_at: localToInstant(s.start_local, zone),
        end_at: localToInstant(s.end_local, zone),
        break_minutes: s.break_minutes,
        status: shiftStatus(s.status),
        active: s.active,
      };
    });

    await client.query(
      `INSERT INTO app.tenant (id, name, time_zone)
       SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[])
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, time_zone = EXCLUDED.time_zone
        WHERE (app.tenant.name, app.tenant.time_zone) IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.time_zone)`,
      [tenantIds, tenants.map((t) => t.name), tenants.map((t) => t.time_zone)],
    );

    await client.query(
      `INSERT INTO app.employee (id, tenant_id, full_name, hourly_rate, active)
       SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::numeric(8,2)[], $5::boolean[])
       ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, full_name = EXCLUDED.full_name,
              hourly_rate = EXCLUDED.hourly_rate, active = EXCLUDED.active
        WHERE (app.employee.tenant_id, app.employee.full_name, app.employee.hourly_rate, app.employee.active)
              IS DISTINCT FROM (EXCLUDED.tenant_id, EXCLUDED.full_name, EXCLUDED.hourly_rate, EXCLUDED.active)`,
      [
        employeeIds,
        employeeTenantIds,
        employees.map((e) => e.full_name),
        employees.map((e) => e.hourly_rate),
        employees.map((e) => e.active),
      ],
    );

    // deleted_at: legacy keeps no deletion time, so a deleted shift gets the time of the first
    // run that saw it deleted; later runs keep that value.
    await client.query(
      `INSERT INTO app.shift (id, tenant_id, employee_id, start_at, end_at, break_minutes, status, deleted_at)
       SELECT u.id, u.tenant_id, u.employee_id, u.start_at, u.end_at, u.break_minutes, u.status,
              CASE WHEN u.active THEN NULL ELSE now() END
         FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::timestamptz[], $5::timestamptz[],
                     $6::integer[], $7::app.shift_status[], $8::boolean[])
              AS u(id, tenant_id, employee_id, start_at, end_at, break_minutes, status, active)
       ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, employee_id = EXCLUDED.employee_id,
              start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at, break_minutes = EXCLUDED.break_minutes,
              status = EXCLUDED.status,
              deleted_at = CASE WHEN EXCLUDED.deleted_at IS NULL THEN NULL
                                ELSE COALESCE(app.shift.deleted_at, EXCLUDED.deleted_at) END
        WHERE (app.shift.tenant_id, app.shift.employee_id, app.shift.start_at, app.shift.end_at,
               app.shift.break_minutes, app.shift.status, app.shift.deleted_at IS NULL)
              IS DISTINCT FROM
              (EXCLUDED.tenant_id, EXCLUDED.employee_id, EXCLUDED.start_at, EXCLUDED.end_at,
               EXCLUDED.break_minutes, EXCLUDED.status, EXCLUDED.deleted_at IS NULL)`,
      [
        shiftRows.map((s) => s.id),
        shiftRows.map((s) => s.tenant_id),
        shiftRows.map((s) => s.employee_id),
        shiftRows.map((s) => s.start_at),
        shiftRows.map((s) => s.end_at),
        shiftRows.map((s) => s.break_minutes),
        shiftRows.map((s) => s.status),
        shiftRows.map((s) => s.active),
      ],
    );

    const idMap: { entity: Entity; legacy_id: number; new_id: string; tenant_id: string }[] = [
      ...tenants.map((t, i) => ({ entity: 'tenant' as const, legacy_id: t.id, new_id: tenantIds[i]!, tenant_id: tenantIds[i]! })),
      ...employees.map((e, i) => ({ entity: 'employee' as const, legacy_id: e.id, new_id: employeeIds[i]!, tenant_id: employeeTenantIds[i]! })),
      ...shiftRows.map((s) => ({ entity: 'shift' as const, legacy_id: s.legacy_id, new_id: s.id, tenant_id: s.tenant_id })),
    ];
    await client.query(
      `INSERT INTO migration.id_map (entity, legacy_id, new_id, tenant_id)
       SELECT * FROM unnest($1::text[], $2::integer[], $3::uuid[], $4::uuid[])
       ON CONFLICT (entity, legacy_id) DO UPDATE SET new_id = EXCLUDED.new_id, tenant_id = EXCLUDED.tenant_id
        WHERE (migration.id_map.new_id, migration.id_map.tenant_id) IS DISTINCT FROM (EXCLUDED.new_id, EXCLUDED.tenant_id)`,
      [idMap.map((m) => m.entity), idMap.map((m) => m.legacy_id), idMap.map((m) => m.new_id), idMap.map((m) => m.tenant_id)],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
};
