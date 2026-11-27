// npm run migrate -- <feature>: runs features/<feature>/migrate.ts as the migrator role.
import { migrationOrder } from '../harness/features/index.ts';
import { loadMigrate } from '../harness/lib/feature.ts';
import { runMain } from '../platform/cli.ts';
import { migratorPool } from '../platform/db.ts';

runMain(async () => {
  const feature = process.argv[2];
  if (!feature) throw new Error('usage: npm run migrate -- <feature>');
  // Features this one builds on (for clock-events: tenants and employees) are migrated first.
  for (const name of migrationOrder(feature)) {
    await (await loadMigrate(name))(migratorPool());
    console.log(`migrate: ${name} done`);
  }
});
