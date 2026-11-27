// npm run migrate -- <feature>: runs features/<feature>/migrate.ts as the migrator role.
import { loadMigrate } from '../harness/lib/feature.ts';
import { runMain } from '../platform/cli.ts';
import { migratorPool } from '../platform/db.ts';

runMain(async () => {
  const feature = process.argv[2];
  if (!feature) throw new Error('usage: npm run migrate -- <feature>');
  await (await loadMigrate(feature))(migratorPool());
  console.log(`migrate: ${feature} done`);
});
