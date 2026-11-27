import { describe, expect, it } from 'vitest';
import { migrationOrder } from './index.ts';

describe('migrationOrder', () => {
  it('migrates what a feature depends on first', () => {
    expect(migrationOrder('timesheet')).toEqual(['timesheet']);
    expect(migrationOrder('clock-events')).toEqual(['timesheet', 'clock-events']);
  });

  it('refuses a feature the registry does not know', () => {
    expect(() => migrationOrder('timesheeet')).toThrow('unknown feature "timesheeet" (known: timesheet, clock-events)');
    expect(() => migrationOrder('constructor')).toThrow('unknown feature');
  });
});
