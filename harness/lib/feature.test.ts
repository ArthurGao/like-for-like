import { describe, expect, it } from 'vitest';
import { forbiddenUse } from './feature.ts';

describe('forbiddenUse', () => {
  it('allows code that only uses the client it is given', () => {
    expect(forbiddenUse(`import type pg from 'pg';\nexport async function calculate(client: pg.PoolClient) { return []; }`)).toBeUndefined();
  });

  it('refuses code that opens connections or reaches for credentials', () => {
    expect(forbiddenUse(`import { adminPool } from '../../platform/db.ts';`)).toBe('adminPool');
    expect(forbiddenUse(`const p = new pg.Pool({ connectionString: x });`)).toBe('connectionString');
    expect(forbiddenUse(`import { urls } from '../../platform/config.ts'; urls.admin`)).toBe('urls.');
    expect(forbiddenUse(`const u = process.env.ADMIN_DATABASE_URL;`)).toBe('process.env');
  });
});
