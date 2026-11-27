---
title: Legacy wall-clock times become instants in the tenant zone; durations are real elapsed time
scope: dates and time zones, migration
source: run 001, feature timesheet, triage by the builder session (Claude) on behalf of the owner (decision D3)
---
Rule: Read a legacy `timestamp` without a zone as wall-clock time in the tenant's IANA zone and store it as `timestamptz`. A local time that occurs twice (clocks go back) is the earlier instant; a local time that does not exist (clocks go forward) moves forward by the gap. A duration is the real elapsed time between the two instants, never the difference of the wall-clock readings. A local date (work date) is taken in the tenant zone, never in UTC or the machine zone.
Why: The brief only said "time between start and end". Pacific/Auckland changes its clocks (5 Apr and 27 Sep 2026), so the two readings differ by an hour, and luxon and Postgres each resolve ambiguous times their own way unless the code chooses explicitly.
Check: `features/timesheet/migrate.test.ts`, describe "localToInstant" (repeated hour → earlier instant, skipped hour → forward); `features/timesheet/calc.test.ts`, "counts real elapsed time on the night clocks go back" and "is the local date the shift started, not the UTC date"; harness `records` check (work_date and paid_hours per shift).
