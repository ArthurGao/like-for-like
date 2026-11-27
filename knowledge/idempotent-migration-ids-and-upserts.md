---
title: Migration ids are UUIDv5 of entity and legacy id; upserts skip unchanged rows and keep first-seen values
scope: migration
source: runs 001-002, feature timesheet, lesson by the migration agent, recorded after the triage of run 001 by the builder session (Claude) on behalf of the owner
---
Rule: Derive every new id as UUIDv5 of `"<entity>:<legacy id>"` under one fixed namespace, and write all rows in one transaction as set-based upserts (`unnest` arrays) that update only when a value differs (`WHERE (...) IS DISTINCT FROM (...)`). A value that legacy does not hold and the migration has to invent (for example `deleted_at` from an `IS_ACTIVE` flag) is set on the first run and kept on later runs. Validate legacy references (tenant, parent, status code, time zone) before writing, and fail with the legacy id.
Why: The harness runs the migration twice and compares checksums of `app.*` and `migration.id_map`. Using `now()` on every run, or random ids, would change data that did not change.
Check: harness `idempotency` check (row counts and md5 per table before and after a second run); `features/timesheet/migrate.test.ts`, describes "uuidv5" (RFC 4122 vector, deterministic per entity and id) and "shiftStatus" (unknown code refused).
