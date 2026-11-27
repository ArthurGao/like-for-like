# Feature brief: Clock events (hours and pay from the time clock)

*Written by the business analyst from the low-code "Clock events" screen and its export.*

## What the screen does

Staff clock in and out at a terminal. The screen pairs each clock-in with its clock-out and shows,
for every pair, the date it counts against, the paid hours and the gross pay. Payroll uses it for
staff who do not enter timesheets, so the numbers must be exactly right to the cent.

## Legacy data

Tenants and employees are the same tables as in the Timesheet feature (already migrated by it).
Every tenant has a time zone. Event times are stored as the **local time** at the tenant, with no
time zone attached.

```sql
CREATE TABLE legacy."OSUSR_A1B_CLOCKEVENT" (
  "ID" integer PRIMARY KEY,
  "TENANTID" integer NOT NULL,
  "EMPLOYEEID" integer NOT NULL,
  "EVENTTYPE" integer NOT NULL,       -- 1 clock-in, 2 clock-out
  "EVENTDATETIME" timestamp NOT NULL, -- local wall-clock time, no zone
  "IS_ACTIVE" boolean NOT NULL        -- false = soft-deleted
);
```

Event types: `1` clock-in, `2` clock-out. `IS_ACTIVE = false` means the event was deleted on the
screen (the row is kept). Events are sometimes entered late, so ids are not in time order.

## Business rules

1. **Which events count.** Only events that are not deleted.
2. **Pairs.** A clock-in is paid when the same employee's next event in time is a clock-out. A
   clock-in followed by another clock-in, or by nothing, is not paid. A clock-out with no clock-in
   before it is ignored.
3. **Hours worked.** Hours worked are the time between the clock-in and the clock-out.
4. **Break.** Terminals do not record breaks: take 30 minutes when the hours worked are more than
   5 hours, otherwise no break.
5. **Paid hours and gross pay.** As in the Timesheet feature: hours worked minus the break,
   rounded to the nearest quarter hour (exactly halfway rounds up); paid hours times the
   employee's hourly rate, rounded to the cent (half a cent rounds up).
6. **Work date.** The local calendar date of the clock-in.

## What to deliver

Migrate **every** clock event (including deleted ones) into `app.clock_event` in
`platform/schema.sql`, and rebuild the screen's calculation on it.

| File | What it does |
|---|---|
| `mapping.md` | Field-by-field mapping, every assumption, every open question |
| `migrate.ts` | Exports `migrate(pool)` (type `MigrateFn` in `harness/contracts.ts`). Writes `app.clock_event` and `migration.id_map` (entity `clock_event`) as the migrator role, with deterministic ids and upserts. Tenants and employees come from the Timesheet migration: `npm run migrate -- clock-events` runs that first. |
| `calc.ts` | Exports `calculate(client, claims)` (type `CalculateFn<ClockShiftRow>`). Runs inside `withTenant`; returns one `ClockShiftRow` per paid pair of that tenant, keyed by the clock-in's new id, decimals as text. |
| `calc.test.ts` | Unit tests for the rules above |

Code from `features/timesheet/` may be reused where it fits. Feature code uses only the pool or
client it is handed.

`npm run migrate -- clock-events` runs the migration; `npm run harness -- clock-events` compares
the result with the legacy screen, pair by pair.
