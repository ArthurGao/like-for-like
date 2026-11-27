import { readFile, readdir } from 'node:fs/promises';
import { errorMessage } from '../../platform/cli.ts';
import type { CalculateFn, MigrateFn } from '../contracts.ts';
import { repoRoot } from './runs.ts';

const NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Feature code runs inside the harness process, which also holds the superuser pool. It may use
 * only the pool or client it is handed, so it must not open connections or reach for credentials.
 */
const FORBIDDEN = [
  'adminPool', 'appPool', 'migratorPool', 'urls.', 'platform/config', 'connectionString',
  'new pg.Pool', 'new Pool(', 'new pg.Client', 'new Client(', 'process.env', 'child_process',
];

export const forbiddenUse = (source: string) => FORBIDDEN.find((f) => source.includes(f));

async function assertFeatureSources(feature: string) {
  const dir = new URL(`features/${feature}/`, repoRoot);
  for (const name of (await readdir(dir).catch(() => [] as string[])).filter((n) => /\.(ts|js|mjs)$/.test(n))) {
    if (name.endsWith('.test.ts')) continue;
    const hit = forbiddenUse(await readFile(new URL(name, dir), 'utf8'));
    if (hit) throw new Error(`features/${feature}/${name} uses "${hit}"; feature code may only use the pool or client it is given`);
  }
}

async function load<T>(feature: string, file: string, exportName: string): Promise<T> {
  if (!NAME_RE.test(feature)) throw new Error(`invalid feature name: ${feature}`);
  await assertFeatureSources(feature);
  const url = new URL(`features/${feature}/${file}`, repoRoot);
  let mod: Record<string, unknown>;
  try {
    mod = (await import(url.href)) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`cannot load features/${feature}/${file}: ${errorMessage(err)}`);
  }
  const fn = mod[exportName];
  if (typeof fn !== 'function') throw new Error(`features/${feature}/${file} must export function ${exportName}`);
  return fn as T;
}

export const loadMigrate = (feature: string) => load<MigrateFn>(feature, 'migrate.ts', 'migrate');
export const loadCalculate = (feature: string) => load<CalculateFn<Record<string, unknown>>>(feature, 'calc.ts', 'calculate');
