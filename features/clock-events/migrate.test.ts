import { describe, expect, it } from 'vitest';
import { clockEventRow, eventType, type LegacyClockEvent } from './migrate.ts';
import { newId } from '../timesheet/migrate.ts';

describe('eventType', () => {
  it('maps the legacy event type codes', () => {
    expect([1, 2].map(eventType)).toEqual(['in', 'out']);
  });

  it('refuses an unknown code', () => {
    expect(() => eventType(3)).toThrow('unknown legacy clock event type: 3');
  });
});

describe('clockEventRow', () => {
  const zones = new Map([[1, 'Pacific/Auckland']]);
  const employeeTenant = new Map([[101, 1], [201, 2]]);
  const legacy = (over: Partial<LegacyClockEvent> = {}): LegacyClockEvent => ({
    id: 7,
    tenant_id: 1,
    employee_id: 101,
    event_type: 1,
    local_at: '2026-04-05 02:30:00',
    active: false,
    ...over,
  });

  it('derives ids, reads the local time in the tenant zone and keeps the deleted flag', () => {
    expect(clockEventRow(legacy(), zones, employeeTenant)).toEqual({
      legacy_id: 7,
      id: newId('clock_event', 7),
      tenant_id: newId('tenant', 1),
      employee_id: newId('employee', 101),
      event_type: 'in',
      occurred_at: '2026-04-04T13:30:00.000Z', // repeated hour -> earlier instant
      active: false,
    });
  });

  it('refuses an unknown employee, naming the event', () => {
    expect(() => clockEventRow(legacy({ employee_id: 999 }), zones, employeeTenant)).toThrow(
      'clock event 7: unknown employee 999',
    );
  });

  it("refuses an event whose tenant differs from its employee's tenant", () => {
    expect(() => clockEventRow(legacy({ employee_id: 201 }), zones, employeeTenant)).toThrow(
      'clock event 7: tenant 1 differs from employee tenant 2',
    );
  });

  it('refuses an unknown tenant, naming the event', () => {
    expect(() =>
      clockEventRow(legacy({ tenant_id: 9 }), zones, new Map([[101, 9]])),
    ).toThrow('clock event 7: unknown tenant 9');
  });
});
