// Reference: how feature code looks on this platform.
// - The caller runs it inside withTenant(claims, ...), so RLS scopes the client to one tenant.
// - The SQL still filters on the tenant from the verified claims (RLS is the backstop).
// - numeric columns stay decimal text; arithmetic is done on integers (BigInt), never floats.
// - The query is thin; the logic is a pure function that can be unit-tested without a database.
import type pg from 'pg';
import type { VerifiedClaims } from '../auth.ts';

export type ActiveEmployee = { id: string; full_name: string; hourly_rate: string };

export async function activeEmployees(
  client: pg.PoolClient,
  claims: VerifiedClaims,
): Promise<{ employees: ActiveEmployee[]; hourlyCost: string }> {
  const { rows } = await client.query<ActiveEmployee>(
    `SELECT id::text, full_name, hourly_rate::text
       FROM app.employee
      WHERE tenant_id = $1 AND active
      ORDER BY full_name, id`,
    [claims['custom:tenant_id']],
  );
  return { employees: rows, hourlyCost: sumMoney(rows.map((r) => r.hourly_rate)) };
}

/** Sum amounts with exactly two decimal places, e.g. ["25.10", "30.05"] -> "55.15". */
export function sumMoney(amounts: readonly string[]): string {
  const cents = amounts.reduce((acc, a) => {
    if (!/^-?\d+\.\d{2}$/.test(a)) throw new Error(`not a money amount: ${a}`);
    return acc + BigInt(a.replace('.', ''));
  }, 0n);
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}
