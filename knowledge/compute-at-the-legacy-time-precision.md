---
title: Compute durations at the time precision legacy pays at; store and order at full precision
scope: dates and time, pay calculation
source: run 003, feature clock-events, triage by the builder session (Claude) on behalf of the owner (decision clock-minutes-only, legacy-bug-keep)
---
Rule: Before a duration feeds a paid quantity, reduce each time to the precision the legacy screen pays at (clock terminals: whole minutes, seconds dropped, truncated in the tenant's local time). Keep the stored instant at full precision and order events by it; the reduction belongs to the calculation, not the migration.
Why: The brief said only "the time between the clock-in and the clock-out". Clock events carry seconds, and on 9 of 222 pairs the seconds moved paid time across a quarter-hour boundary (for example 12:37:35-21:00:04 pays 8.00 h at whole minutes, 7.75 h with seconds). Payroll has always paid whole minutes, so the new system reproduces it.
Check: `features/clock-events/calc.test.ts`, describe "clockShiftRows: whole minutes only (triage clock-minutes-only, run 003)" (rounds up, rounds down, and ordering still uses the exact time); harness `records` and `totals` checks (run 004: 0 unexplained).
