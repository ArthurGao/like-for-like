---
title: A confirmed time-zone rule is kept when another legacy screen differs; the difference is triaged per record until the owner decides
scope: dates and time zones, triage
source: run 003, feature clock-events, triage by the builder session (Claude) on behalf of the owner (decision clock-repeated-hour, acceptable pending the product owner)
---
Rule: A rule already confirmed for the platform (D3: a repeated local time is the earlier instant) is applied to every new feature, even when that feature's legacy screen resolves the time differently. The harness difference is triaged per record and named as an open question for the product owner; the agent does not change the rule, or special-case one feature, without a decision.
Why: The clock screen reads a clock-out at 02:30 on 2026-04-05 in Auckland (the repeated hour) as the later instant, so legacy pair 295 pays 5.00 h where the new system pays 4.50 h. Following legacy here would have quietly given clock events a different meaning of local time from timesheets.
Check: `features/timesheet/migrate.test.ts`, describe "localToInstant" ("reads the repeated hour when DST ends as the earlier instant"), which clock-events shares; `features/clock-events/migrate.test.ts`, describe "clockEventRow" (occurred_at of 02:30 on 2026-04-05 is the earlier instant); harness run 004 lists pair 295 under triage `clock-repeated-hour` and no other mismatch.
