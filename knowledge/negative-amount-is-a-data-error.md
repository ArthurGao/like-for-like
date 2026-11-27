---
title: Negative paid time is a data error; refuse it by name, never pay a negative amount
scope: domain, pay calculation
source: run 001, feature timesheet, triage by the builder session (Claude) on behalf of the owner (decision D2)
---
Rule: When inputs give a negative quantity that is paid (a break longer than the shift, an end before the start), the calculation throws an error naming the record. It never clamps the value and never emits a negative amount. The migration copies such a row unchanged and does not repair it (for example by adding a day). A quantity of exactly zero is valid and pays 0.00.
Why: The brief did not say what happens to such rows. Rounding would have turned them into negative or zero pay with no signal, and payroll is run from this list.
Check: `features/timesheet/calc.test.ts`, describe "timesheetRow: negative paid time is a data error (decision D2, run 001)" (three tests: break longer than the shift, end before the start, exactly zero still pays); a harness run lists any refused shift under `calcErrors` in `report.json`.
