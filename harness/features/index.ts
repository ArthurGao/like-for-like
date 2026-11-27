// The features the harness knows: how to read legacy results and inputs, which entities to count,
// which result field is the record id, and which features must be migrated first.
import type pg from 'pg';
import type { CountEntity } from '../checks/counts.ts';
import type { ResultKey } from '../lib/new-rows.ts';
import type { CompareRow, ShiftInputs } from '../lib/types.ts';
import * as clockEvents from './clock-events.ts';
import * as timesheet from './timesheet.ts';

export type Feature = {
  legacyRows: (admin: pg.ClientBase) => Promise<CompareRow[]>;
  shiftInputs: (admin: pg.ClientBase) => Promise<Map<number, ShiftInputs>>;
  key: ResultKey;
  counts: CountEntity[];
  dependsOn: string[];
};

const TENANT: CountEntity = { entity: 'tenant', legacy: 'OSUSR_A1B_TENANT', legacyTenant: 'ID', app: 'app.tenant', appTenant: 'id' };
const EMPLOYEE: CountEntity = { entity: 'employee', legacy: 'OSUSR_A1B_EMPLOYEE', legacyTenant: 'TENANTID', app: 'app.employee', appTenant: 'tenant_id' };

export const FEATURES: Record<string, Feature> = {
  timesheet: {
    ...timesheet,
    counts: [TENANT, EMPLOYEE, { entity: 'shift', legacy: 'OSUSR_A1B_SHIFT', legacyTenant: 'TENANTID', app: 'app.shift', appTenant: 'tenant_id' }],
    dependsOn: [],
  },
  'clock-events': {
    ...clockEvents,
    counts: [TENANT, EMPLOYEE, { entity: 'clock_event', legacy: 'OSUSR_A1B_CLOCKEVENT', legacyTenant: 'TENANTID', app: 'app.clock_event', appTenant: 'tenant_id' }],
    dependsOn: ['timesheet'],
  },
};

export const tenantNames = timesheet.tenantNames;
export const featureNames = () => Object.keys(FEATURES);
export const getFeature = (name: string): Feature | undefined => (Object.hasOwn(FEATURES, name) ? FEATURES[name] : undefined);
