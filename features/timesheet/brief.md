# Feature brief: Timesheet (hours and pay)

*Written by the business analyst from the low-code "Timesheet" screen and its export.*

## What the screen does

Payroll staff open the Timesheet screen to see, for each shift that can be paid, the date it
counts against, the paid hours and the gross pay. Payroll is run from this list, so the numbers
must be exactly right to the cent.

## Legacy data

Each tenant (customer company) has its own employees and shifts. Every tenant has a time zone
(an IANA name such as `Australia/Brisbane`). Shift start and end are stored as the **local time**
at the tenant, with no time zone attached.

```sql
CREATE TABLE legacy."OSUSR_A1B_TENANT" (
  "ID" integer PRIMARY KEY,
  "NAME" text NOT NULL,
  "TIMEZONE" text NOT NULL            -- IANA name
);

CREATE TABLE legacy."OSUSR_A1B_EMPLOYEE" (
  "ID" integer PRIMARY KEY,
  "TENANTID" integer NOT NULL,
  "FULLNAME" text NOT NULL,
  "HOURLYRATE" numeric(8,2) NOT NULL,
  "IS_ACTIVE" boolean NOT NULL
);

CREATE TABLE legacy."OSUSR_A1B_SHIFT" (
  "ID" integer PRIMARY KEY,
  "TENANTID" integer NOT NULL,
  "EMPLOYEEID" integer NOT NULL,
  "STARTDATETIME" timestamp NOT NULL, -- local wall-clock time, no zone
  "ENDDATETIME" timestamp NOT NULL,   -- local wall-clock time, no zone
  "BREAKMIN" integer NULL,            -- NULL = not recorded
  "STATUS" integer NOT NULL,          -- 1 draft, 2 approved, 3 paid
  "IS_ACTIVE" boolean NOT NULL        -- false = soft-deleted
);
```

Status codes: `1` draft, `2` approved, `3` paid. `IS_ACTIVE = false` on a shift means it was
deleted on the screen (the row is kept).

## Business rules

1. **Which shifts are payable.** Only shifts that are not deleted and whose status is approved or
   paid. Whether the employee is still active does not matter: past shifts of a person who has
   left are still payable.
2. **Hours worked.** Hours worked are the time between the start and the end of the shift.
3. **Break.** If a break was recorded, use it (a recorded 0 means no break). If no break was
   recorded, take 30 minutes when the hours worked are more than 5 hours, otherwise no break.
4. **Paid hours.** Hours worked minus the break, rounded to the nearest quarter hour. Exactly
   halfway rounds up.
5. **Gross pay.** Paid hours times the employee's hourly rate, rounded to the cent. Exactly
   half a cent rounds up.
6. **Work date.** The local calendar date on which the shift started.

## What to deliver

Migrate **every** legacy row (tenants, employees and all shifts, including drafts and deleted
ones) into the new model in `platform/schema.sql`, and rebuild the screen's calculation on it.

| File | What it does |
|---|---|
| `mapping.md` | Field-by-field mapping, every assumption, every open question |
| `migrate.ts` | Exports `migrate(pool)` (type `MigrateFn` in `harness/contracts.ts`). Reads `legacy`, writes `app` and `migration.id_map` as the migrator role. Ids are deterministic (UUIDv5 from entity + legacy id) and rows are upserted, so a second run changes nothing. |
| `calc.ts` | Exports `calculate(client, claims)` (type `CalculateFn`). Runs inside `withTenant`; returns one `TimesheetRow` per payable shift of that tenant, decimals as text. A pure function does the arithmetic; the query feeds it. |
| `calc.test.ts` | Unit tests for the rules above |

`npm run migrate -- timesheet` runs the migration; `npm run harness -- timesheet` compares the
result with the legacy screen, shift by shift.
