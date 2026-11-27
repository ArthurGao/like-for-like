import pg from 'pg';
import { urls } from './config.ts';
import type { VerifiedClaims } from './auth.ts';

// Every pool returns DATE and TIMESTAMP (without time zone) as the text Postgres sends, so a
// value is never re-interpreted in the time zone of the machine running the code.
const AS_TEXT = new Set<number>([pg.types.builtins.DATE, pg.types.builtins.TIMESTAMP]);
const types = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
    AS_TEXT.has(oid) ? (v: string) => v : pg.types.getTypeParser(oid, format)) as typeof pg.types.getTypeParser,
};
const pool = (connectionString: string, max: number) => new pg.Pool({ connectionString, max, types });

let app: pg.Pool | undefined;
let migrator: pg.Pool | undefined;
let admin: pg.Pool | undefined;
let runtimeRoleChecked: Promise<void> | undefined;

export const appPool = () => (app ??= pool(urls.appUser, 4));
export const migratorPool = () => (migrator ??= pool(urls.migrator, 2));
/** Superuser pool. For reset, seed and the harness only. */
export const adminPool = () => (admin ??= pool(urls.admin, 2));

/**
 * Refuse to run tenant queries as a role that row-level security does not hold:
 * a superuser, a BYPASSRLS role, or the owner of the tenant tables.
 */
export async function assertRuntimeRole(client: pg.ClientBase): Promise<void> {
  const { rows } = await client.query<{
    superuser: boolean;
    bypassrls: boolean;
    owns: boolean;
  }>(
    `SELECT r.rolsuper AS superuser, r.rolbypassrls AS bypassrls,
            EXISTS (SELECT 1 FROM pg_tables t
                    WHERE t.schemaname = 'app' AND pg_has_role(current_user, t.tableowner, 'USAGE')) AS owns
       FROM pg_roles r WHERE r.rolname = current_user`,
  );
  const r = rows[0];
  if (!r || r.superuser || r.bypassrls || r.owns) {
    throw new Error(`runtime role is not held by row-level security: ${JSON.stringify(r)}`);
  }
}

/**
 * Run fn in one transaction as app_user, scoped to the tenant in the verified claims.
 * The tenant setting is transaction-local, so it cannot leak to the next user of the connection.
 */
export async function withTenant<T>(
  claims: VerifiedClaims,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await appPool().connect();
  try {
    runtimeRoleChecked ??= assertRuntimeRole(client);
    await runtimeRoleChecked;
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [claims['custom:tenant_id']]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function closePools(): Promise<void> {
  await Promise.all([app?.end(), migrator?.end(), admin?.end()]);
  app = migrator = admin = undefined;
  runtimeRoleChecked = undefined;
}
