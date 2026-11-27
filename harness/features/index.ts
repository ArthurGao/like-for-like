// The features the harness knows: how to read legacy results and inputs, which entities to count,
// which result field is the record id, and which features must be migrated first.
import type pg from 'pg';
import type { CountEntity } from '../checks/counts.ts';
import type { ResultKey } from '../lib/new-rows.ts';
import type { CompareRow, ShiftInputs } from '../lib/types.ts';
import * as clockEvents from './clock-events.ts';
import * as timesheet from './timesheet.ts';

export type Feature = {
  legacyFn: string;
  legacyRows: (admin: pg.ClientBase) => Promise<CompareRow[]>;
  shiftInputs: (admin: pg.ClientBase) => Promise<Map<number, ShiftInputs>>;
  key: ResultKey;
  counts: CountEntity[];
  dependsOn: string[];
};

const BASE_COUNTS: CountEntity[] = [
  { entity: 'tenant', legacy: 'OSUSR_A1B_TENANT', legacyTenant: 'ID', app: 'app.tenant', appTenant: 'id' },
  { entity: 'employee', legacy: 'OSUSR_A1B_EMPLOYEE', legacyTenant: 'TENANTID', app: 'app.employee', appTenant: 'tenant_id' },
];

const FEATURES: Record<string, Feature> = {
  timesheet: {
    ...timesheet,
    counts: [...BASE_COUNTS, { entity: 'shift', legacy: 'OSUSR_A1B_SHIFT', legacyTenant: 'TENANTID', app: 'app.shift', appTenant: 'tenant_id' }],
    dependsOn: [],
  },
  'clock-events': {
    ...clockEvents,
    counts: [...BASE_COUNTS, { entity: 'clock_event', legacy: 'OSUSR_A1B_CLOCKEVENT', legacyTenant: 'TENANTID', app: 'app.clock_event', appTenant: 'tenant_id' }],
    dependsOn: ['timesheet'],
  },
};

export async function tenantNames(admin: pg.ClientBase): Promise<string[]> {
  const { rows } = await admin.query<{ name: string }>(`SELECT "NAME" AS name FROM legacy."OSUSR_A1B_TENANT" ORDER BY "ID"`);
  return rows.map((r) => r.name);
}

/** Every app table some feature migrates into (for the idempotency checksums). */
export const appTables = () => [...new Set(Object.values(FEATURES).flatMap((f) => f.counts.map((c) => c.app)))];
export const featureNames = () => Object.keys(FEATURES);
export const getFeature = (name: string): Feature | undefined => (Object.hasOwn(FEATURES, name) ? FEATURES[name] : undefined);

/** The features to migrate for `feature`, dependencies first. Throws on a name the registry does not know. */
export function migrationOrder(feature: string): string[] {
  const spec = getFeature(feature);
  if (!spec) throw new Error(`unknown feature "${feature}" (known: ${featureNames().join(', ')})`);
  return [...spec.dependsOn.flatMap(migrationOrder), feature];
}
