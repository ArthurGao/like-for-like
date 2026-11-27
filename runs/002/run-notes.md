# Run 002: timesheet (after triage of run 001)

## What was done

1. **Step 6, applying the decisions** in `runs/001/decisions.md`:
   - **D1**: already done by the builder in `platform/schema.sql` (composite FK
     `(tenant_id, employee_id)`) together with the isolation check, in commit `d77fbfc`. No change
     to feature code: `migrate.ts` writes tenants, then employees, then shifts, which satisfies
     the new key.
   - **D2** (commit `abf33d0`): `computePay` now throws when paid time (worked minus break) is
     negative. A new pure function `timesheetRow` builds the full row and adds the shift id to
     the error message. `calculate` is now a query plus `filter(isPayable).map(timesheetRow)`.
     Paid time of exactly zero still pays 0.00. The migration is unchanged and copies such rows
     as they are. `mapping.md` now lists the decisions in place of the open questions.
   - Tests: 3 new tests in `features/timesheet/calc.test.ts` (describe "timesheetRow: negative
     paid time is a data error"). They went red first because the function did not exist. Then
     two mutations each went red: removing the guard made the two refusal tests fail, and `<= 0`
     made the zero-pays test fail. After restoring the code, `npm test` passed 55/55 and
     `npm run typecheck` exited 0.
2. **Step 4**: `db:reset`, `seed` (3 tenants, 24 employees, 1011 shifts), then
   `migrate -- timesheet`. Exit 0.
3. **Step 5**: `harness -- timesheet` passed all 5 checks (counts, totals, records, isolation,
   idempotency). It compared 914 records with 0 mismatches and 0 unexplained, and `calcErrors`
   is empty, so no seeded shift has negative paid time. Totals are unchanged from run 001.
4. **Step 7**: five knowledge entries written (see below).

## Knowledge entries applied

None at the start (`knowledgeEntriesAtStart: 0`). The entries below were written at the end of
this run, for the next feature.

## Knowledge entries written

| File | From |
|---|---|
| `knowledge/tenant-scoped-child-foreign-key.md` | D1 |
| `knowledge/negative-amount-is-a-data-error.md` | D2 |
| `knowledge/local-wall-clock-to-instant.md` | D3 |
| `knowledge/round-in-integer-units-half-up.md` | lesson from this migration |
| `knowledge/idempotent-migration-ids-and-upserts.md` | lesson from this migration |

## What the human decided

The decisions were made by the builder session (Claude) on behalf of the owner, who delegated
them (`runs/001/decisions.md`, 2026-11-27). D1: accepted, enforced in the schema. D2: negative
paid time is refused with an error naming the shift. D3: the DST assumptions are confirmed as
rules. `harness/triage.yaml` stayed empty because neither run had any mismatch.

## Notes for the next session

- The migration guard blocks direct queries on `legacy`, `git show`, and ranged `git diff`.
  Pipes and redirects on a command that names a protected path count as writes. Run npm scripts
  without pipes, and use `npm run legacy:sample` to look at legacy data.
- Neither run could tell whether the seed holds a shift that crosses an Auckland DST change.
  The D3 rules are covered by unit tests, not by a known legacy row.
