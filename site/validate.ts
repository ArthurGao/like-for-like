// Run files are written by tools and by the agent; the page builder trusts nothing in them.
// Feature names end up in file paths and figures end up in HTML, so both are checked here.
import { featureNames } from '../harness/features/index.ts';

const SUMMARY = ['checks', 'passed', 'failed', 'recordsCompared', 'mismatches', 'unexplained'] as const;
const META = ['harnessRuns', 'knowledgeEntriesAtStart', 'knowledgeEntriesAtEnd', 'session.durationMinutes', 'session.humanStops',
  'guardAudit.transcripts', 'guardAudit.toolCalls'] as const;

const get = (o: any, path: string) => path.split('.').reduce((v, k) => v?.[k], o);

function integer(run: string, label: string, v: unknown, optional = false) {
  if (optional && v === undefined) return;
  if (!Number.isInteger(v)) throw new Error(`run ${run}: ${label} is not an integer`);
}

export function checkReport<R extends { feature: unknown }>(run: string, report: R): R {
  const r = report as any;
  if (typeof r.feature !== 'string' || !featureNames().includes(r.feature)) {
    throw new Error(`run ${run}: unknown feature ${JSON.stringify(r.feature)}`);
  }
  integer(run, 'knowledgeEntriesAtStart', r.knowledgeEntriesAtStart);
  for (const k of SUMMARY) integer(run, `summary.${k}`, r.summary?.[k]);
  (r.mismatches ?? []).forEach((m: any, i: number) => integer(run, `mismatches[${i}].legacyShiftId`, m.legacyShiftId));
  return report;
}

/** Each named (dotted) path of `o` must be an integer. */
export function checkIntegers<T>(run: string, o: T, paths: readonly string[]): T {
  for (const k of paths) integer(run, k, get(o, k));
  return o;
}

export function checkMeta<M>(run: string, meta: M): M {
  for (const k of META) integer(run, `meta ${k}`, get(meta, k), true);
  return meta;
}
