import { errorMessage } from '../../platform/cli.ts';
import type { CalculateFn, MigrateFn } from '../contracts.ts';
import { repoRoot } from './runs.ts';

const NAME_RE = /^[a-z][a-z0-9-]*$/;

async function load<T>(feature: string, file: string, exportName: string): Promise<T> {
  if (!NAME_RE.test(feature)) throw new Error(`invalid feature name: ${feature}`);
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
export const loadCalculate = (feature: string) => load<CalculateFn>(feature, 'calc.ts', 'calculate');
