---
title: Reuse a feature's helpers by import; extract a shared module only when a third feature needs them
scope: code structure, migration
source: run 003, feature clock-events, decision D4 by the builder session (Claude) on behalf of the owner (runs/003/decisions.md)
---
Rule: A new feature imports the helpers of an earlier feature (`newId`, `localToInstant`, `computePay` from `features/timesheet/`) instead of copying them. It adds only what it needs, for example a new entity name in the `Entity` union. A shared module is extracted when a third feature needs the same helpers, so its shape comes from three users.
Why: Clock-events needed the same id derivation, wall-clock reading and pay rounding as timesheet. Copies would let the two features drift apart without the harness noticing, and a shared module shaped by two users would be a guess.
Check: `features/clock-events/migrate.test.ts` (ids equal `newId('clock_event', …)` from timesheet) and `features/timesheet/migrate.test.ts`, describe "uuidv5"; the harness `idempotency` check runs both migrations.
