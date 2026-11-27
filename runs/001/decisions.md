# Decisions after run 001

Run 001 passed every check with no mismatches, so `harness/triage.yaml` stays empty. These are
decisions on the open questions in `features/timesheet/mapping.md` and in the run 001 summary.

Decided by: the builder session (Claude), on behalf of the demo owner, who delegated these
decisions. Date: 2026-11-27.

| # | Question | Decision | Who changes what |
|---|---|---|---|
| D1 | `app.shift` did not guarantee that a shift and its employee belong to the same tenant. | Accepted. A child row carries `tenant_id` and references its parent by `(tenant_id, id)`. | Builder: composite foreign key in `platform/schema.sql` and an isolation check ("shift pointing at another tenant's employee is rejected"), commit `d77fbfc`. |
| D2 | A break longer than the shift, or an end at or before the start, gives negative paid hours. | A shift with negative paid time is a data error: the calculation refuses it with an error naming the shift; it is never paid as a negative amount. The migration still copies the row as it is. | Migration agent: `calc.ts` and a unit test. |
| D3 | Hours worked across a clock change; which instant an ambiguous local time means. | Confirmed as rules: hours worked are the real elapsed time between the two instants in the tenant's zone; a local time that occurs twice (clocks go back) is the earlier instant; a local time that does not exist (clocks go forward) moves forward by the gap. | Migration agent: knowledge entries. |
