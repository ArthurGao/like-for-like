---
title: A child row references its parent by (tenant_id, id), so it cannot point across tenants
scope: platform tenancy, schema
source: run 001, feature timesheet, triage by the builder session (Claude) on behalf of the owner (decision D1)
---
Rule: Every tenant-owned child table carries its own `tenant_id` and references its parent with a composite foreign key `(tenant_id, parent_id) → parent (tenant_id, id)`, backed by `UNIQUE (tenant_id, id)` on the parent. A migration still checks the pairing itself, so its error names the legacy row.
Why: Before the fix, `app.shift` referenced `app.employee` by `id` alone. A runtime write could pair a shift with another tenant's employee, and a calculation that joins on `tenant_id` would silently drop the row (missing pay, no error). RLS does not catch this, because each row on its own passes the policy.
Check: harness isolation check "shift pointing at another tenant's employee is rejected" (`harness/checks/isolation.ts`, also listed in `platform/isolation.test.ts`); `features/timesheet/migrate.ts` fails with "shift N: tenant X differs from employee tenant Y".
