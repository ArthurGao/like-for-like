# Run 004: clock-events (after triage of run 003)

## What was done

1. **Steps 1-3** (commits `e765867` Map, `26bee5b` Build):
   - `features/clock-events/mapping.md`: maps every `OSUSR_A1B_CLOCKEVENT` field; nothing is left
     unmigrated.
   - `migrate.ts` and `migrate.test.ts`: `clock_event` ids via the timesheet `newId`, local times
     via `localToInstant`, one transaction with set-based upserts. `deleted_at` is kept from the
     first run. The event type is validated, and so is the event tenant against the employee
     tenant.
   - `calc.ts` and `calc.test.ts`: a pure function `pairEvents` (rules 1-2) and `clockShiftRows`
     (rules 3-6, the timesheet `computePay` with no recorded break). `calculate` is a thin query.
   - `features/timesheet/migrate.ts`: the only change is that the `Entity` union gained
     `'clock_event'`.
   - `/simplify` ran 4 review agents and 3 small fixes were applied. The Codex review could not
     run: this headless session is not allowed to start the companion script.
2. **Run 003** (commit `f076058`): counts, isolation and idempotency passed. Records and totals
   failed: 222 pairs compared, 10 pairs (20 mismatches) differed, with no missing or extra pairs.
   Two groups: 9 pairs where legacy drops seconds, and pair 295 at the repeated DST hour.
3. **Step 6** (commit `547f102`): applied `clock-minutes-only` (legacy-bug-keep).
   - `clockShiftRows` truncates both times to the start of their local minute before
     `computePay`.
   - `occurred_at` keeps the seconds, and pairing still orders by the exact time.
   - `clock-repeated-hour` is accepted, so no code was changed for it.
4. **Tests**: three new tests in describe "clockShiftRows: whole minutes only (triage
   clock-minutes-only, run 003)".
   - The two pay tests went red first with the run-003 values: 7.75 instead of 8.00, and 6.50
     instead of 6.25.
   - The ordering test went red under a mutation that sorted by whole minutes.
   - The Build-step test "rounds paid time to the nearest quarter, exactly halfway up" used a
     time with seconds (07:37:30) to make a quarter-hour tie. With seconds dropped, that tie
     cannot occur. It was replaced by a whole-minute half-cent tie test, plus a test that the
     old input now pays 7.00 h.
   - `npm test`: 83/83. `npm run typecheck`: exit 0.
5. **Run 004**: `db:reset`, `seed` (466 clock events), `migrate -- clock-events`, then
   `harness -- clock-events`, which exited 0.
   - All 5 checks passed. 222 records compared, 2 mismatches, 0 unexplained. `calcErrors` is
     empty.
   - The only remaining difference is pair 295 (paid_hours 5.00 vs 4.50, gross 165.05 vs
     148.55), explained by `clock-repeated-hour`.
6. **Step 7**: four knowledge entries were written (see below).

## Knowledge entries applied

All five that existed at the start (`knowledgeEntriesAtStart: 5`):

| Entry | How |
|---|---|
| `idempotent-migration-ids-and-upserts` | UUIDv5 `clock_event:<ID>`, unnest upserts with `IS DISTINCT FROM`, `deleted_at` first-seen and kept, references validated with the legacy id in the error; harness idempotency passed |
| `local-wall-clock-to-instant` | `EVENTDATETIME` read in the tenant zone with the shared `localToInstant`; elapsed time; work date in the tenant zone |
| `round-in-integer-units-half-up` | pay via the shared `computePay` (BigInt quarters, then cents, half up) |
| `negative-amount-is-a-data-error` | errors name the clock-in; a same-instant pair pays 0.00 |
| `tenant-scoped-child-foreign-key` | the migration checks that the event tenant equals the employee tenant (`clock event N: tenant X differs from employee tenant Y`); the calc joins on `(id, tenant_id)` |

## Knowledge entries written

| File | From |
|---|---|
| `knowledge/compute-at-the-legacy-time-precision.md` | triage `clock-minutes-only` |
| `knowledge/repeated-hour-rule-is-not-inherited-by-legacy.md` | triage `clock-repeated-hour` |
| `knowledge/sequence-rules-on-live-rows-by-time.md` | lesson from this migration |
| `knowledge/extract-shared-code-at-the-third-user.md` | D4 |

## What the human decided

The decisions were made by the builder session (Claude) on behalf of the demo owner on
2026-11-27, in `harness/triage.yaml` and `runs/003/decisions.md`:

- **`clock-minutes-only`** (legacy-bug-keep, legacy pairs 146, 279, 305, 311, 313, 330, 359,
  408, 457): payroll has always paid whole minutes, so the new system reproduces it.
- **`clock-repeated-hour`** (acceptable, pair 295): which instant a clock-out at the repeated
  local hour means is a question for the product owner. Until it is answered, D3 (the earlier
  instant) stays.
- **D4**: no shared module yet; extract one when a third feature needs these helpers.
- **D5**: `npm run legacy:sample` now prints every legacy table (changed by the builder).

## Notes for the next session

- **Open with the product owner**: `clock-repeated-hour`. If the answer is "later instant", that
  is a change to D3 for clock events and needs a new decision, not an edit of the existing entry.
- **Codex review**: it has not been run on this feature's diff. Run `/codex:review` from an
  interactive session.
- **Same-instant ties**: an in and an out of one employee at the same instant are ordered by the
  new uuid. Legacy probably uses `ID`. Runs 003 and 004 showed no such tie.
