# Timesheet: field mapping

Knowledge entries applied: none (the `knowledge/` folder holds only `README.md`; this is the
first migrated feature).

Ids: `uuidv5(NAMESPACE, "<entity>:<legacy id>")` with entity `tenant`, `employee` or `shift` and
a fixed namespace in `migrate.ts`. Every legacy row gets one `migration.id_map` row
(`entity`, `legacy_id`, `new_id`, `tenant_id` = new tenant id; for a tenant, its own id).

## legacy."OSUSR_A1B_TENANT" → app.tenant

| Legacy field | New field | Notes |
|---|---|---|
| `ID` | `id` | UUIDv5 of `tenant:<ID>` |
| `NAME` | `name` | as is |
| `TIMEZONE` | `time_zone` | as is; must be a valid IANA zone or the migration fails |

## legacy."OSUSR_A1B_EMPLOYEE" → app.employee

| Legacy field | New field | Notes |
|---|---|---|
| `ID` | `id` | UUIDv5 of `employee:<ID>` |
| `TENANTID` | `tenant_id` | new id of the legacy tenant; unknown tenant fails the migration |
| `FULLNAME` | `full_name` | as is |
| `HOURLYRATE` | `hourly_rate` | numeric(8,2) → numeric(8,2), copied as decimal text (never a float) |
| `IS_ACTIVE` | `active` | as is |

## legacy."OSUSR_A1B_SHIFT" → app.shift

| Legacy field | New field | Notes |
|---|---|---|
| `ID` | `id` | UUIDv5 of `shift:<ID>` |
| `TENANTID` | `tenant_id` | new id of the legacy tenant; must equal the employee's tenant or the migration fails |
| `EMPLOYEEID` | `employee_id` | new id of the legacy employee; unknown employee fails the migration |
| `STARTDATETIME` | `start_at` | local wall-clock time read in the tenant's `TIMEZONE`, stored as an instant |
| `ENDDATETIME` | `end_at` | same as `start_at` |
| `BREAKMIN` | `break_minutes` | as is, `NULL` kept as `NULL` (= not recorded; 0 stays 0) |
| `STATUS` | `status` | `1` → `draft`, `2` → `approved`, `3` → `paid`; any other code fails the migration |
| `IS_ACTIVE` | `deleted_at` | `true` → `NULL`; `false` → time of the first migration run that saw it deleted (kept on later runs) |

All shifts are migrated, including drafts and deleted ones. Nothing is "not migrated".

## Calculation (TimesheetRow)

| Output | Source |
|---|---|
| `shift_id`, `tenant_id`, `employee_id` | new uuids |
| `work_date` | local calendar date (tenant time zone) of `start_at` |
| `paid_hours` | rules 2–4, two decimals |
| `gross_pay` | rule 5, two decimals |

Payable: `deleted_at IS NULL AND status IN ('approved', 'paid')`, employee `active` ignored.

## Assumptions

- **Hours worked is real elapsed time** (`end_at - start_at` as instants), not the difference of
  the wall-clock readings. For a shift that spans a DST change (Pacific/Auckland, 5 Apr 2026 and
  27 Sep 2026) the two differ by one hour; the harness will show whether legacy agrees.
- **Ambiguous local time** (the repeated hour when DST ends) is read as the **earlier** instant
  (daylight offset); **non-existent local time** (the skipped hour when DST starts) is moved
  forward by the gap (luxon's behaviour). Neither can be checked before migrating: the session
  guard does not allow ad-hoc queries on `legacy`.
- "More than 5 hours" compares the exact hours worked (before rounding) with 5 h, strictly.
- Paid hours are rounded from exact seconds to the nearest 900 s (quarter hour), half up
  (towards +∞). Gross pay is computed from the **rounded** paid hours.
- Half a cent rounds up (towards +∞); with positive hours and rates this is the usual half-up.
- `paid_hours` and `gross_pay` are always formatted with two decimals ("8.00", "181.98").
- Deletion time is unknown in legacy, so `deleted_at` records when the migration first saw the
  row deleted; only its NULL/non-NULL state carries meaning.

## Open questions

None left open. Decided after run 001 (`runs/001/decisions.md`):

- **D1**: a shift and its employee must belong to the same tenant. The schema now enforces this
  with the composite foreign key `(tenant_id, employee_id) → app.employee (tenant_id, id)`; the
  migration still checks it so the error names the shift.
- **D2**: negative paid time (a break longer than the shift, or an end before the start) is a
  data error. `calculate` refuses it with an error naming the shift and never pays a negative
  amount. The migration still copies such a row unchanged and does not "fix" it by adding a
  day. Paid time of exactly zero is not negative and pays 0.00.
- **D3**: the DST assumptions above are confirmed as rules.
