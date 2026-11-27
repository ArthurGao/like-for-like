// Drop and recreate every schema. Roles are cluster-wide and created once if missing.
import { readFile, readdir } from 'node:fs/promises';
import { repoRoot as root } from '../harness/lib/runs.ts';
import { runMain } from '../platform/cli.ts';
import { roles } from '../platform/config.ts';
import { adminPool } from '../platform/db.ts';

const sql = (path: string) => readFile(new URL(path, root), 'utf8');

runMain(async () => {
  const db = adminPool();
  const ensureRole = (name: string, attrs: string) =>
    db.query(`DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${name}') THEN
                  CREATE ROLE ${name};
                END IF;
              END $$`).then(() => db.query(`ALTER ROLE ${name} ${attrs}`));

  await ensureRole('app_owner', 'NOLOGIN NOSUPERUSER NOBYPASSRLS');
  await ensureRole(
    roles.appUser.name,
    `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD '${roles.appUser.password}'`,
  );
  await ensureRole(
    roles.migrator.name,
    `LOGIN NOSUPERUSER BYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD '${roles.migrator.password}'`,
  );

  await db.query('DROP SCHEMA IF EXISTS app, migration, legacy CASCADE');
  await db.query(await sql('legacy/schema.sql'));
  const logicDir = new URL('legacy/logic/', root);
  for (const f of (await readdir(logicDir)).filter((f) => f.endsWith('.sql')).sort()) {
    await db.query(await readFile(new URL(f, logicDir), 'utf8'));
  }
  await db.query(await sql('platform/schema.sql'));
  console.log('db:reset: schemas legacy, app, migration recreated');
});
