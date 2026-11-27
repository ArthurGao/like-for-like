// Runs the harness isolation checks against the local database (npm run db:up && npm run db:reset).
import { afterAll, describe, expect, it } from 'vitest';
import { PROBE_TENANTS, checkIsolation } from '../harness/checks/isolation.ts';
import { adminPool, closePools } from './db.ts';

afterAll(closePools);

describe('tenant isolation', () => {
  it('passes every negative test and leaves no probe rows behind', async () => {
    const admin = await adminPool().connect();
    try {
      const results = await checkIsolation(admin);
      expect(results.filter((r) => !r.ok)).toEqual([]);
      expect(results.map((r) => r.name)).toEqual([
        'runtime role is not superuser, not BYPASSRLS and owns no app table',
        'tenant A token sees zero rows of tenant B',
        'tenant A token sees its own rows',
        "tenant A token filtering on tenant B's id returns zero rows",
        "insert with another tenant's id is rejected",
        'update moving a row to another tenant is rejected',
        'no tenant set returns zero rows (also on a reused connection)',
        'app_user cannot disable row-level security',
        'app_user cannot read legacy or migration tables',
        "shift pointing at another tenant's employee is rejected",
        'token signed with another key is rejected',
      ]);
      const { rows } = await admin.query<{ n: number }>(
        `SELECT (SELECT count(*) FROM app.tenant WHERE id = ANY($1))
              + (SELECT count(*) FROM app.employee WHERE tenant_id = ANY($1))
              + (SELECT count(*) FROM app.shift WHERE tenant_id = ANY($1)) AS n`,
        [PROBE_TENANTS],
      );
      expect(Number(rows[0]!.n)).toBe(0);
    } finally {
      admin.release();
    }
  });
});
