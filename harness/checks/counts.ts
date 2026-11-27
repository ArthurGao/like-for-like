import type pg from 'pg';

export type CountRow = { tenant: string; entity: string; legacy: number; migrated: number; ok: boolean };

const ENTITIES = [
  { entity: 'tenant', legacy: `"OSUSR_A1B_TENANT"`, legacyTenant: `"ID"`, app: 'app.tenant', appTenant: 'id' },
  { entity: 'employee', legacy: `"OSUSR_A1B_EMPLOYEE"`, legacyTenant: `"TENANTID"`, app: 'app.employee', appTenant: 'tenant_id' },
  { entity: 'shift', legacy: `"OSUSR_A1B_SHIFT"`, legacyTenant: `"TENANTID"`, app: 'app.shift', appTenant: 'tenant_id' },
] as const;

/**
 * Every legacy row is in scope. Migrated rows are counted per new tenant id and matched to the
 * legacy tenant through migration.id_map. Rows under an unmapped tenant id count as "(unmapped)".
 */
export async function checkCounts(admin: pg.ClientBase): Promise<CountRow[]> {
  const out: CountRow[] = [];
  const { rows: tenants } = await admin.query<{ id: number; name: string; new_id: string | null }>(
    `SELECT t."ID" AS id, t."NAME" AS name, m.new_id
       FROM legacy."OSUSR_A1B_TENANT" t
       LEFT JOIN migration.id_map m ON m.entity = 'tenant' AND m.legacy_id = t."ID"
      ORDER BY t."ID"`,
  );
  for (const e of ENTITIES) {
    const legacy = await admin.query<{ tid: number; n: number }>(
      `SELECT ${e.legacyTenant} AS tid, count(*)::int AS n FROM legacy.${e.legacy} GROUP BY 1`,
    );
    const migrated = await admin.query<{ tid: string; n: number }>(
      `SELECT ${e.appTenant}::text AS tid, count(*)::int AS n FROM ${e.app} GROUP BY 1`,
    );
    const legacyBy = new Map(legacy.rows.map((r) => [r.tid, r.n]));
    const migratedBy = new Map(migrated.rows.map((r) => [r.tid, r.n]));
    for (const t of tenants) {
      const l = legacyBy.get(t.id) ?? 0;
      const m = t.new_id ? (migratedBy.get(t.new_id) ?? 0) : 0;
      if (t.new_id) migratedBy.delete(t.new_id);
      out.push({ tenant: t.name, entity: e.entity, legacy: l, migrated: m, ok: l === m });
    }
    const stray = [...migratedBy.values()].reduce((a, b) => a + b, 0);
    if (stray > 0) out.push({ tenant: '(unmapped)', entity: e.entity, legacy: 0, migrated: stray, ok: false });
  }
  return out;
}
