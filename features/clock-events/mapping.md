# Clock events: field mapping

Knowledge entries applied:

- `idempotent-migration-ids-and-upserts`: ids are UUIDv5 of `clock_event:<ID>` under the same
  namespace as the timesheet migration (shared `newId`); one transaction, set-based upserts
  that skip unchanged rows; `deleted_at` set on the first run and kept; tenant, employee, event
  type and time zone checked before writing, errors name the legacy id.
- `local-wall-clock-to-instant`: `EVENTDATETIME` is read in the tenant zone with the shared
  `localToInstant` (repeated hour → earlier instant, skipped hour → forward by the gap); hours
  worked are real elapsed time; the work date is the local date in the tenant zone.
- `round-in-integer-units-half-up`: paid hours and pay come from the timesheet `computePay`
  (BigInt milliseconds → quarters half up → cents half up, two decimals).
- `negative-amount-is-a-data-error`: a pair with negative paid time is refused with an error
  naming the clock-in; zero pays 0.00.
- `tenant-scoped-child-foreign-key`: `app.clock_event` already has the composite foreign key;
  the migration still checks that the event's tenant equals its employee's tenant and names the
  event when it does not.

Tenants and employees are migrated by the timesheet migration (`dependsOn`), not here.

## legacy."OSUSR_A1B_CLOCKEVENT" → app.clock_event

| Legacy field | New field | Notes |
|---|---|---|
| `ID` | `id` | UUIDv5 of `clock_event:<ID>`; one `migration.id_map` row (entity `clock_event`, `tenant_id` = new tenant id) |
| `TENANTID` | `tenant_id` | new id of the legacy tenant; unknown tenant, or a tenant that differs from the employee's, fails the migration |
| `EMPLOYEEID` | `employee_id` | new id of the legacy employee; unknown employee fails the migration |
| `EVENTTYPE` | `event_type` | `1` → `in`, `2` → `out`; any other code fails the migration |
| `EVENTDATETIME` | `occurred_at` | local wall-clock time read in the tenant's `TIMEZONE`, stored as an instant |
| `IS_ACTIVE` | `deleted_at` | `true` → `NULL`; `false` → time of the first migration run that saw it deleted (kept on later runs) |

Every event is migrated, including deleted ones. Nothing is "not migrated".

## Calculation (ClockShiftRow)

| Output | Source |
|---|---|
| `clock_in_id` | new id of the clock-in event |
| `tenant_id`, `employee_id` | new uuids of the clock-in |
| `work_date` | rule 6: local calendar date (tenant zone) of the clock-in |
| `paid_hours` | rules 3–5: elapsed time clock-in → clock-out, minus 30 min when over 5 h, nearest quarter half up |
| `gross_pay` | rule 5: paid hours × employee `hourly_rate`, to the cent half up |

Pairing (rules 1–2), per employee, over the tenant's events with `deleted_at IS NULL` sorted by
`occurred_at`: a clock-in is paid when the next event is a clock-out. Every other event produces
no row.

## Assumptions

- **Deleted events are removed before pairing** (rule 1), so a deleted event between a clock-in
  and a clock-out does not break the pair, and a deleted clock-out never closes one.
- **Order is by instant, not by legacy id** (ids are not in time order). Reading wall-clock time
  with the earlier-instant rule keeps the order of the wall-clock readings, so this equals legacy
  ordering by `EVENTDATETIME`.
- **Same-instant ties** within one employee are broken by the new uuid, because the runtime role
  cannot see legacy ids. Legacy probably breaks ties by `ID`; if the data has ties between a
  clock-in and a clock-out, the harness will show it (see open questions).
- **No maximum shift length**: a clock-in whose next event is a clock-out days later is paid
  for the whole span, as the brief states rule 2 without a limit.
- The break is never recorded, so `computePay` is called with `breakMinutes: null` (rule 4 is
  the timesheet default-break rule: strictly more than 5 h of exact elapsed time).
- The employee's `active` flag does not matter, as in the timesheet feature.
- The rate is the employee's current `hourly_rate` (legacy has no rate history).

## Open questions

Decided after run 003 (`harness/triage.yaml`, `runs/003/decisions.md`; by the builder session on
behalf of the owner):

- **`clock-minutes-only`** (legacy-bug-keep, 9 pairs): legacy drops the seconds of both event
  times before computing hours. `clockShiftRows` truncates each time to the start of its local
  minute before `computePay`; `occurred_at` keeps the seconds, and pairing still orders by the
  exact time. With whole minutes a quarter-hour tie cannot occur; half-cent ties still can.
- **`clock-repeated-hour`** (acceptable, 1 pair, legacy 295): legacy reads a clock-out at the
  repeated local hour when DST ends as the later instant; the new system keeps D3 (earlier
  instant). Still open with the product owner.
- **D4**: shared helpers stay in `features/timesheet/` until a third feature needs them.

Still unobserved: same-instant ties between a clock-in and a clock-out of one employee (ordered
by new uuid here); run 003 showed none.
