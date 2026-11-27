# Run 001: timesheet

## What was done

1. **Read**: `knowledge/` (README only), `features/timesheet/brief.md`, `legacy/schema.sql`,
   `npm run legacy:sample`, `platform/schema.sql`, `db.ts`, `auth.ts`, `reference/`,
   `harness/contracts.ts`.
2. **Map** (`bc928b6`): `features/timesheet/mapping.md`, with every legacy field, the assumptions
   and the open questions.
3. **Build** (`666e6aa`): `migrate.ts`, `calc.ts`, `calc.test.ts`, `migrate.test.ts`.
   - Ids are UUIDv5 of `<entity>:<legacy id>`. Every write is an upsert that skips unchanged
     rows, all in one transaction as the migrator.
   - Legacy wall-clock times become instants in the tenant zone. A repeated local time counts
     as the earlier instant; a skipped one moves forward by the gap.
   - The query only feeds rows. The pure `computePay` does rules 2 to 6 on BigInt
     (milliseconds, quarters, cents) with half-up rounding. Rule 1 lives only in `isPayable`.
   - Unit tests cover 26 cases. Three mutations went red before being restored: half-up
     rounding, the strict "more than 5 h" test, and the earlier instant for a repeated local time.
4. **Migrate**: `db:reset`, `seed`, then `migrate -- timesheet`, run twice. Both runs exit 0.
5. **Validate**: `harness -- timesheet` passed all 5 checks (counts, totals, records, isolation,
   idempotency). It compared 914 records with 0 mismatches and 0 unexplained.

## Knowledge entries applied

None. This was the first run, and `knowledge/` held only `README.md`
(`knowledgeEntriesAtStart: 0`).

## What the human decided

No triage was needed because the harness reported no mismatches, so `harness/triage.yaml` was
not touched. For the same reason no knowledge entry was written:
`knowledge/README.md` allows entries only after triage.

## Left open for the human

- **Pairing of shift tenant and employee tenant.** The schema does not enforce it: there is no
  composite foreign key `(tenant_id, employee_id)`. The migration checks it and fails loudly,
  but runtime writes by `app_user` could still pair a shift with another tenant's employee, and
  `calc.ts` would then silently drop that shift. This touches tenancy and `platform/schema.sql`,
  so it is the human's call.
- **Shifts with end before start, or with a break longer than the shift.** These would produce
  negative pay. Codex flagged it, and it is already in the Open questions of `mapping.md`. The
  harness found no differences, so no seeded row exposed it, but nothing checks for it either.
- **DST assumptions.** Elapsed time is used, and a repeated hour counts as the earlier instant.
  These match legacy on this data. A single run cannot tell whether the seed contains any
  shift that crosses an Auckland DST change.
