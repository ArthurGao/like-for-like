// Negative tests for tenant isolation, run through withTenant as app_user.
// Two probe tenants are inserted by the superuser, used, and removed again.
import { SignJWT, generateKeyPair } from 'jose';
import type pg from 'pg';
import { AUDIENCE, ISSUER, signToken, verifyToken, type VerifiedClaims } from '../../platform/auth.ts';
import { errorMessage } from '../../platform/cli.ts';
import { appPool, assertRuntimeRole, withTenant } from '../../platform/db.ts';
import type { NamedCheck } from '../lib/types.ts';

const A = { tenant: 'a0000000-0000-4000-8000-00000000000a', employee: 'a0000000-0000-4000-8000-0000000000e1', shift: 'a0000000-0000-4000-8000-0000000000f1' };
const B = { tenant: 'b0000000-0000-4000-8000-00000000000b', employee: 'b0000000-0000-4000-8000-0000000000e1', shift: 'b0000000-0000-4000-8000-0000000000f1' };
export const PROBE_TENANTS = [A.tenant, B.tenant];

async function removeProbes(admin: pg.ClientBase) {
  await admin.query('DELETE FROM app.shift WHERE tenant_id = ANY($1)', [PROBE_TENANTS]);
  await admin.query('DELETE FROM app.employee WHERE tenant_id = ANY($1)', [PROBE_TENANTS]);
  await admin.query('DELETE FROM app.tenant WHERE id = ANY($1)', [PROBE_TENANTS]);
}

async function insertProbes(admin: pg.ClientBase) {
  for (const [p, name] of [[A, 'Probe tenant A'], [B, 'Probe tenant B']] as const) {
    await admin.query(`INSERT INTO app.tenant (id, name, time_zone) VALUES ($1, $2, 'UTC')`, [p.tenant, name]);
    await admin.query(
      `INSERT INTO app.employee (id, tenant_id, full_name, hourly_rate, active) VALUES ($1, $2, 'Probe', 30.00, true)`,
      [p.employee, p.tenant],
    );
    await admin.query(
      `INSERT INTO app.shift (id, tenant_id, employee_id, start_at, end_at, break_minutes, status)
       VALUES ($1, $2, $3, '2026-01-05 09:00Z', '2026-01-05 17:00Z', 30, 'approved')`,
      [p.shift, p.tenant, p.employee],
    );
  }
}

/** The SQLSTATE (or message) of the error fn throws, or null if it does not throw. */
async function errorCode(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? errorMessage(err);
  }
}

/** Every named statement must fail with insufficient_privilege (42501). */
async function denied(attempts: Record<string, () => Promise<unknown>>) {
  const codes = await Promise.all(Object.entries(attempts).map(async ([k, fn]) => [k, await errorCode(fn)] as const));
  return {
    ok: codes.every(([, c]) => c === '42501'),
    detail: codes.map(([k, c]) => `${k}: ${c ?? 'no error'}`).join(', '),
  };
}

const countAs = (claims: VerifiedClaims, sql: string, params: unknown[] = []) =>
  withTenant(claims, async (c) => Number((await c.query<{ n: string }>(sql, params)).rows[0]!.n));

export async function checkIsolation(admin: pg.ClientBase): Promise<NamedCheck[]> {
  await removeProbes(admin);
  await insertProbes(admin);
  const results: NamedCheck[] = [];
  const check = async (name: string, fn: () => Promise<{ ok: boolean; detail?: string }>) => {
    try {
      results.push({ name, ...(await fn()) });
    } catch (err) {
      results.push({ name, ok: false, detail: errorMessage(err) });
    }
  };

  try {
    const a = await verifyToken(await signToken({ sub: 'probe-a', tenantId: A.tenant }));

    await check('runtime role is not superuser, not BYPASSRLS and owns no app table', async () => {
      const client = await appPool().connect();
      try {
        await assertRuntimeRole(client);
        return { ok: true };
      } finally {
        client.release();
      }
    });

    await check('tenant A token sees zero rows of tenant B', async () => {
      const n = await countAs(a,
        `SELECT (SELECT count(*) FROM app.tenant WHERE id <> $1)
              + (SELECT count(*) FROM app.employee WHERE tenant_id <> $1)
              + (SELECT count(*) FROM app.shift WHERE tenant_id <> $1)
              + (SELECT count(*) FROM app.clock_event WHERE tenant_id <> $1) AS n`, [A.tenant]);
      return { ok: n === 0, detail: `${n} foreign rows visible` };
    });

    await check('tenant A token sees its own rows', async () => {
      const n = await countAs(a, 'SELECT count(*) AS n FROM app.shift');
      return { ok: n === 1, detail: `${n} shift rows visible, expected 1` };
    });

    await check("tenant A token filtering on tenant B's id returns zero rows", async () => {
      const n = await countAs(a, 'SELECT count(*) AS n FROM app.shift WHERE tenant_id = $1', [B.tenant]);
      return { ok: n === 0, detail: `${n} rows` };
    });

    await check("insert with another tenant's id is rejected", () =>
      denied({
        insert: () => withTenant(a, (c) => c.query(
          `INSERT INTO app.shift (id, tenant_id, employee_id, start_at, end_at, status)
           VALUES (gen_random_uuid(), $1, $2, now(), now(), 'draft')`, [B.tenant, B.employee])),
      }));

    await check('update moving a row to another tenant is rejected', () =>
      denied({
        update: () => withTenant(a, (c) => c.query('UPDATE app.shift SET tenant_id = $1 WHERE id = $2', [B.tenant, A.shift])),
      }));

    await check('no tenant set returns zero rows (also on a reused connection)', async () => {
      await withTenant(a, (c) => c.query('SELECT 1')); // leaves a used connection in the pool
      const counts: number[] = [];
      for (let i = 0; i < 2; i++) {
        const client = await appPool().connect();
        try {
          counts.push(Number((await client.query<{ n: string }>('SELECT count(*) AS n FROM app.shift')).rows[0]!.n));
        } finally {
          client.release();
        }
      }
      return { ok: counts.every((n) => n === 0), detail: `counts ${counts.join(', ')}` };
    });

    await check('app_user cannot disable row-level security', () =>
      denied({
        alter: () => withTenant(a, (c) => c.query('ALTER TABLE app.shift DISABLE ROW LEVEL SECURITY')),
        'row_security off': () => withTenant(a, async (c) => {
          await c.query('SET LOCAL row_security = off');
          await c.query('SELECT count(*) FROM app.shift');
        }),
      }));

    await check('app_user cannot read legacy or migration tables', () =>
      denied({
        legacy: () => withTenant(a, (c) => c.query('SELECT 1 FROM legacy."OSUSR_A1B_SHIFT" LIMIT 1')),
        id_map: () => withTenant(a, (c) => c.query('SELECT 1 FROM migration.id_map LIMIT 1')),
      }));

    await check("shift pointing at another tenant's employee is rejected", async () => {
      await admin.query('BEGIN');
      try {
        const code = await errorCode(() => admin.query(
          `INSERT INTO app.shift (id, tenant_id, employee_id, start_at, end_at, status)
           VALUES (gen_random_uuid(), $1, $2, now(), now(), 'draft')`, [A.tenant, B.employee]));
        return { ok: code === '23503', detail: `error ${code ?? 'none'} (23503 = foreign key violation)` };
      } finally {
        await admin.query('ROLLBACK');
      }
    });

    await check('token signed with another key is rejected', async () => {
      const { privateKey } = await generateKeyPair('RS256');
      const forged = await new SignJWT({ 'custom:tenant_id': B.tenant, 'cognito:groups': ['staff'], token_use: 'id' })
        .setProtectedHeader({ alg: 'RS256' }).setSubject('forged').setIssuer(ISSUER).setAudience(AUDIENCE)
        .setIssuedAt().setExpirationTime('5m').sign(privateKey);
      const err = await errorCode(() => verifyToken(forged));
      return { ok: err === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED', detail: err ?? 'accepted' };
    });
  } finally {
    await removeProbes(admin);
  }
  return results;
}
