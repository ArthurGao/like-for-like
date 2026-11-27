// npm run legacy:sample: print a few rows of each legacy table per tenant (read-only, migrator role).
import { runMain } from '../platform/cli.ts';
import { migratorPool } from '../platform/db.ts';

const TABLES = ['OSUSR_A1B_TENANT', 'OSUSR_A1B_EMPLOYEE', 'OSUSR_A1B_SHIFT'] as const;

runMain(async () => {
  const db = migratorPool();
  for (const table of TABLES) {
    const tenantCol = table === 'OSUSR_A1B_TENANT' ? '"ID"' : '"TENANTID"';
    const { rows } = await db.query(
      `SELECT * FROM (
         SELECT *, row_number() OVER (PARTITION BY ${tenantCol} ORDER BY "ID") AS n
           FROM legacy."${table}") x
        WHERE n <= 4 ORDER BY ${tenantCol}, "ID"`,
    );
    const { rows: total } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM legacy."${table}"`);
    console.log(`\n${table} (${total[0]!.n} rows; first 4 per tenant)`);
    console.table(rows.map(({ n: _n, ...r }) => r));
  }
});
