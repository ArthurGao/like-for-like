---
name: migrate-feature
description: Migrate one legacy feature to the new multi-tenant platform and prove it with the harness. Use when asked to migrate a feature (for example "migrate the timesheet feature").
---

# Migrate one feature

`<name>` is the feature folder under `features/`. Every step ends with a commit whose message
starts with the step name, for example `Map: timesheet field mapping`.

## 1. Read

- Every file in `knowledge/` (start with `knowledge/README.md`). List the entries that apply.
- `features/<name>/brief.md`.
- The legacy DDL (`legacy/schema.sql`) and a sample of legacy rows: `npm run legacy:sample`
  (read-only).
- `platform/schema.sql`, `platform/db.ts`, `platform/auth.ts`, `platform/reference/`,
  `harness/contracts.ts`.

## 2. Map

Write `features/<name>/mapping.md`: a table mapping every legacy field to its new field (or
"not migrated", with the reason), then **Assumptions** and **Open questions** as lists.
If any open question affects correctness, stop and ask the human.

## 3. Build

Write `migrate.ts`, `calc.ts` and `calc.test.ts` in `features/<name>/`, following
`platform/reference/` and the types in `harness/contracts.ts`. Run `npm test` and
`npm run typecheck`; both must pass.

## 4. Migrate

```
npm run db:reset && npm run seed && npm run migrate -- <name>
```

## 5. Validate

```
npm run harness -- <name>
```

The harness writes `runs/<nnn>/report.json`. Do not treat any mismatch as acceptable. Summarise
the failed checks and the mismatches (grouped, with their inputs) and **stop**. The human
records a decision for each group in `harness/triage.yaml`.

## 6. After human triage

Fix what was triaged as `new-system-bug` (and `legacy-bug-keep`: the new system must reproduce
legacy). Do not change behaviour triaged as `legacy-bug-fix` or `acceptable`. Re-run steps 4 and
5. Repeat until the harness exits 0.

## 7. Record

- For each lesson, write one file `knowledge/<slug>.md` in this format:

  ```
  ---
  title: <one line>
  scope: <domain or platform area>
  source: run <nnn>, feature <name>, triage by <human>
  ---
  Rule: <one or two sentences, stated as a rule>
  Why: <what went wrong or what was unclear>
  Check: <how the harness or a test proves it>
  ```

- Write `runs/<nnn>/run-notes.md` for the last run: what was done, which knowledge entries were
  applied, what the human decided.
