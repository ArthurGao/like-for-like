// Validation harness. Deterministic, no model calls. Usage:
//   npm run harness -- <feature> [--no-record]
// Exit code is non-zero if any check fails or any difference is unexplained.
import { errorMessage, runMain } from '../platform/cli.ts';
import { adminPool, migratorPool } from '../platform/db.ts';
import { checkCounts } from './checks/counts.ts';
import { checkIdempotency, type IdempotencyResult } from './checks/idempotency.ts';
import { checkIsolation } from './checks/isolation.ts';
import * as timesheet from './features/timesheet.ts';
import { compareResults } from './lib/compare.ts';
import { loadCalculate, loadMigrate } from './lib/feature.ts';
import { countKnowledgeEntries, nextRunNumber, repoRoot, writeReport } from './lib/runs.ts';
import { applyTriage, loadTriage } from './lib/triage.ts';
import type { CompareRow } from './lib/types.ts';

const FEATURES = ['timesheet'] as const;

runMain(async () => {
  const feature = process.argv[2];
  const record = !process.argv.includes('--no-record');
  if (feature !== 'timesheet') {
    console.error(`usage: npm run harness -- <${FEATURES.join('|')}> [--no-record]`);
    return 2;
  }
  const startedAt = new Date().toISOString();
  const run = record ? await nextRunNumber() : null;
  const knowledgeEntriesAtStart = await countKnowledgeEntries();
  const triage = await loadTriage(new URL('harness/triage.yaml', repoRoot));
  const admin = await adminPool().connect();

  try {
    // 1. Counts
    const counts = await checkCounts(admin);

    // 2 and 3. Totals and records
    const tenants = await timesheet.tenantNames(admin);
    const legacy = await timesheet.legacyRows(admin);
    const inputs = await timesheet.shiftInputs(admin);
    let fresh: CompareRow[] = [];
    let calcErrors: string[] = [];
    try {
      ({ rows: fresh, errors: calcErrors } = await timesheet.newRows(admin, await loadCalculate(feature)));
    } catch (err) {
      calcErrors = [errorMessage(err)];
    }
    const compared = compareResults(tenants, legacy, fresh, inputs);
    const triaged = applyTriage(compared.mismatches, triage);
    const calcOk = calcErrors.length === 0;
    const tenantExplained = (tenant: string) => calcOk && !triaged.unexplainedTenants.has(tenant);
    const totals = compared.totals.map((t) => ({ ...t, explained: !t.ok && tenantExplained(t.tenant) }));

    // 4. Isolation
    const isolation = await checkIsolation(admin);

    // 5. Idempotency
    let idempotency: IdempotencyResult;
    try {
      const migrate = await loadMigrate(feature);
      idempotency = await checkIdempotency(admin, () => migrate(migratorPool()));
    } catch (err) {
      idempotency = { ok: false, before: [], after: [], error: errorMessage(err) };
    }

    const checks = [
      { name: 'counts', ok: counts.every((c) => c.ok) },
      {
        name: 'totals',
        ok: calcOk && totals.every((t) => t.ok || t.explained) &&
          compared.weeklyTotals.rows.every((w) => tenantExplained(w.tenant)),
      },
      { name: 'records', ok: calcOk && triaged.unexplained.length === 0 },
      { name: 'isolation', ok: isolation.every((c) => c.ok) },
      { name: 'idempotency', ok: idempotency.ok },
    ];
    const passed = checks.filter((c) => c.ok).length;

    const report = {
      run,
      feature,
      startedAt,
      finishedAt: new Date().toISOString(),
      knowledgeEntriesAtStart,
      summary: {
        checks: checks.length,
        passed,
        failed: checks.length - passed,
        recordsCompared: compared.compared,
        mismatches: triaged.mismatches.length,
        unexplained: triaged.unexplained.length,
      },
      checks,
      counts,
      totals,
      weeklyTotals: compared.weeklyTotals,
      calcErrors,
      mismatches: triaged.mismatches,
      triage: { applied: triaged.applied, unmatched: triaged.unmatched },
      isolation,
      idempotency,
    };

    for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}`);
    console.log(
      `records compared ${compared.compared}, mismatches ${triaged.mismatches.length}, unexplained ${triaged.unexplained.length}` +
        (calcErrors.length ? `, calculation errors ${calcErrors.length} (first: ${calcErrors[0]})` : ''),
    );
    if (idempotency.error) console.log(`idempotency: ${idempotency.error}`);
    for (const c of isolation.filter((x) => !x.ok)) console.log(`isolation FAIL: ${c.name} (${c.detail})`);
    if (run) console.log(`report: ${await writeReport(run, report)}`);
    else console.log(JSON.stringify(report.summary));
    return passed === checks.length ? 0 : 1;
  } finally {
    admin.release();
  }
});
