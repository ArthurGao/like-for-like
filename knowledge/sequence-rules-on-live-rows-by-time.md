---
title: "Next event" rules run on live rows, per owner, ordered by time (never by id), in a pure function
scope: domain, event pairing
source: runs 003-004, feature clock-events, lesson by the migration agent, recorded after the triage of run 003 by the builder session (Claude) on behalf of the owner
---
Rule: A rule that looks at the next or previous record (pair a clock-in with the next event) drops soft-deleted rows first, groups by the owner (employee), orders by the instant with a fixed tie-break, and is a pure function over the rows the query returns; the SQL does not order or pair. Each condition gets a test: deleted rows in between, late-entered rows (ids not in time order), another owner's rows at the boundary, and mixed UTC offsets.
Why: Legacy ids are not in time order, and the runtime role cannot see legacy ids, so ordering by id would silently pair the wrong events. Done this way, the pairing matched legacy on all 222 pairs in run 003 (no missing or extra rows); every mismatch was in the hours.
Check: `features/clock-events/calc.test.ts`, describes "pairEvents: which events count (rule 1)" and "pairEvents: pairs (rule 2)"; harness `records` check (no missing or extra pairs in runs 003 and 004).
