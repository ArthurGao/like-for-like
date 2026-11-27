import type pg from 'pg';
import { errorMessage } from '../../platform/cli.ts';

const TABLES = ['app.tenant', 'app.employee', 'app.shift', 'app.clock_event', 'migration.id_map'] as const;

export type TableChecksum = { table: string; rows: number; md5: string };
export type IdempotencyResult = {
  ok: boolean;
  before: TableChecksum[];
  after: TableChecksum[];
  error?: string;
};

export async function checksums(admin: pg.ClientBase): Promise<TableChecksum[]> {
  const out: TableChecksum[] = [];
  for (const table of TABLES) {
    const { rows } = await admin.query<{ rows: number; md5: string }>(
      `SELECT count(*)::int AS rows,
              md5(coalesce(string_agg(t::text, E'\\n' ORDER BY t::text), '')) AS md5
         FROM ${table} t`,
    );
    out.push({ table, ...rows[0]! });
  }
  return out;
}

/** Run the migration a second time; every table's count and checksum must be unchanged. */
export async function checkIdempotency(
  admin: pg.ClientBase,
  runMigration: () => Promise<void>,
): Promise<IdempotencyResult> {
  const before = await checksums(admin);
  try {
    await runMigration();
  } catch (err) {
    return { ok: false, before, after: [], error: errorMessage(err) };
  }
  const after = await checksums(admin);
  if (before.every((c) => c.rows === 0)) return { ok: false, before, after, error: 'nothing migrated' };
  const ok = before.every((c, i) => c.rows === after[i]!.rows && c.md5 === after[i]!.md5);
  return { ok, before, after };
}
