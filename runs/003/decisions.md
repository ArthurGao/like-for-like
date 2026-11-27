# Decisions after run 003

Harness mismatches are decided in `harness/triage.yaml` (`clock-minutes-only`: legacy-bug-keep,
9 pairs; `clock-repeated-hour`: acceptable pending the product owner, 1 pair). This file holds the
decision on the other question the agent raised.

Decided by: the builder session (Claude), on behalf of the demo owner. Date: 2026-11-27.

| # | Question | Decision | Who changes what |
|---|---|---|---|
| D4 | `newId`, `localToInstant`, `computePay` and the id-map upsert live in `features/timesheet/` and are imported or copied by clock-events. Move them to a shared module now? | Not yet: extract a shared module when a third feature needs them, so its shape comes from three users rather than two. | Nobody for now. |
| D5 | `npm run legacy:sample` does not show the clock-event table. | Fixed by the builder: the sample prints every legacy table. | Builder: `scripts/legacy-sample.ts`. |
