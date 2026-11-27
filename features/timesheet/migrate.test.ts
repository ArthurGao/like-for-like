import { describe, expect, it } from 'vitest';
import { localToInstant, newId, shiftStatus, uuidv5 } from './migrate.ts';

describe('uuidv5', () => {
  it('matches the RFC 4122 v5 value for a known name', () => {
    // Namespace DNS, name "www.example.com"
    expect(uuidv5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });

  it('gives the same id for the same entity and legacy id, and different ids otherwise', () => {
    expect(newId('shift', 1)).toBe(newId('shift', 1));
    expect(newId('shift', 1)).not.toBe(newId('employee', 1));
    expect(newId('shift', 1)).not.toBe(newId('shift', 2));
  });
});

describe('localToInstant', () => {
  it('reads the legacy wall-clock time in the tenant time zone', () => {
    expect(localToInstant('2026-03-23 10:45:00', 'Pacific/Auckland')).toBe('2026-03-22T21:45:00.000Z');
    expect(localToInstant('2026-03-23 07:22:00', 'Australia/Brisbane')).toBe('2026-03-22T21:22:00.000Z');
    expect(localToInstant('2026-03-23 11:30:00', 'Pacific/Fiji')).toBe('2026-03-22T23:30:00.000Z');
  });

  it('reads the repeated hour when DST ends as the earlier instant', () => {
    // 2026-04-05 02:30 happens at +13 and again at +12 in Auckland
    expect(localToInstant('2026-04-05 02:30:00', 'Pacific/Auckland')).toBe('2026-04-04T13:30:00.000Z');
  });

  it('moves a time in the skipped hour when DST starts forward by the gap', () => {
    // 2026-09-27 02:30 does not exist in Auckland; it is read as 03:30 +13
    expect(localToInstant('2026-09-27 02:30:00', 'Pacific/Auckland')).toBe('2026-09-26T14:30:00.000Z');
  });

  it('refuses an unknown time zone or a malformed time', () => {
    expect(() => localToInstant('2026-03-23 10:45:00', 'Mars/Olympus')).toThrow('Mars/Olympus');
    expect(() => localToInstant('23/03/2026 10:45', 'Pacific/Auckland')).toThrow('23/03/2026 10:45');
  });
});

describe('shiftStatus', () => {
  it('maps the legacy status codes', () => {
    expect([1, 2, 3].map(shiftStatus)).toEqual(['draft', 'approved', 'paid']);
  });

  it('refuses an unknown code', () => {
    expect(() => shiftStatus(4)).toThrow('unknown legacy shift status: 4');
  });
});
