# like-for-like: design and plan

A small, public demo of one idea: **an agent rebuilds and migrates one feature, a deterministic harness proves the result matches the original, and a human decides what each difference means.**

This document is the brief for Claude Code. Build exactly what is described here. Where something is marked *stretch*, skip it unless everything else is finished.

---

## 1. Purpose and rules

### What the demo shows

1. A legacy feature (timesheet hours and pay) living in low-code-style tables.
2. An agent (Claude Code, driven by a skill) that maps the legacy model to a new multi-tenant model, generates the migration code and the rebuilt calculation, and runs them.
3. A validation harness (plain TypeScript, no AI) that compares legacy and new results per tenant and per record.
4. A human triage step, and a knowledge base where each lesson is written down so the next feature starts from it.
5. Tenant isolation enforced by PostgreSQL row-level security and proven by negative tests.

### Honesty rules (non-negotiable)

- All data is synthetic. No real company, client or person appears anywhere in the repo or the page. Tenant names are invented.
- Do not name any real consultancy or client in the repo, the commits or the page.
- Everything shown on the web page comes from files written by real runs (`runs/**`). Nothing on the page is typed in by hand.
- If the agent gets the feature right on the first run, the page says so. Do not stage a failure and present it as spontaneous. The seeded-fault check (section 6.4) exists so the harness can still be shown catching an error, and it is always labelled as seeded.
- The JWT used for tenancy is a locally signed stand-in for an Amazon Cognito token. The README and the page say this in plain words.

### Non-goals

- No hosted backend, no live database behind the page, no real Cognito, no NestJS/Next.js app, no CDK.
- No custom agent loop. The agent is Claude Code.
- No more than one feature (plus one stretch feature).

---

## 2. Stack

- Node.js 20+, TypeScript (strict), npm
- PostgreSQL 16 in Docker (`docker compose up -d`)
- `pg` for database access, `luxon` for time zones, `jose` for JWTs, `vitest` for tests, `tsx` to run scripts
- No ORM. SQL files are plain `.sql`.

---

## 3. Repository layout

```
like-for-like/
  README.md
  CLAUDE.md                       # rules for the migration agent (section 7.1)
  docker-compose.yml
  package.json
  .claude/
    settings.json                 # denies reading legacy/logic/** (section 7.3)
    skills/migrate-feature/SKILL.md
  legacy/
    schema.sql                    # low-code-style tables
    seed.ts                       # deterministic synthetic data
    logic/timesheet.sql           # the ORIGINAL behaviour. Black box to the agent.
  platform/
    schema.sql                    # target tables, roles, RLS policies
    db.ts                         # withTenant(claims, fn)
    auth.ts                       # sign/verify stand-in Cognito tokens
    reference/                    # one tiny example of "how code looks here"
  features/
    timesheet/
      brief.md                    # what the agent is given (section 5.3)
      mapping.md                  # WRITTEN BY THE AGENT
      migrate.ts                  # WRITTEN BY THE AGENT
      calc.ts                     # WRITTEN BY THE AGENT
      calc.test.ts                # WRITTEN BY THE AGENT
  harness/
    run.ts                        # entry point
    checks/                       # counts, totals, records, isolation, idempotency
    triage.yaml                   # human decisions about each difference
    seeded-fault.ts               # section 6.4
  knowledge/
    README.md                     # how entries are written
    (entries written by the agent after human triage)
  runs/
    001/ report.json, run-notes.md, meta.json
    002/ ...
  site/
    template.html
    build.ts                      # injects runs/** into the template
    dist/index.html               # the page that gets published
```

npm scripts: `db:up`, `db:reset`, `seed`, `migrate -- <feature>`, `harness -- <feature>`, `harness:seeded`, `site:build`, `test`.

---

## 4. Two separate sessions

This matters for honesty.

- **Builder session** (phases A and C in section 9): builds the legacy side, the platform, the harness and the page. It writes and reads `legacy/logic/`.
- **Migration session** (phase B): a **fresh** Claude Code session with no memory of the builder session, started in the same repo, with `legacy/logic/**` denied. It only runs the `migrate-feature` skill.

The builder must not write hints about the legacy logic anywhere the migration session can read (not in `CLAUDE.md`, the skill, the brief, code comments, test names or commit messages).

---

## 5. The legacy side

### 5.1 Tables (`legacy` schema)

Names imitate a low-code platform's generated names.

```sql
CREATE TABLE legacy."OSUSR_A1B_TENANT" (
  "ID" integer PRIMARY KEY,
  "NAME" text NOT NULL,
  "TIMEZONE" text NOT NULL            -- IANA name
);

CREATE TABLE legacy."OSUSR_A1B_EMPLOYEE" (
  "ID" integer PRIMARY KEY,
  "TENANTID" integer NOT NULL,
  "FULLNAME" text NOT NULL,
  "HOURLYRATE" numeric(8,2) NOT NULL,
  "IS_ACTIVE" boolean NOT NULL
);

CREATE TABLE legacy."OSUSR_A1B_SHIFT" (
  "ID" integer PRIMARY KEY,
  "TENANTID" integer NOT NULL,
  "EMPLOYEEID" integer NOT NULL,
  "STARTDATETIME" timestamp NOT NULL, -- LOCAL wall-clock time, no zone
  "ENDDATETIME" timestamp NOT NULL,   -- LOCAL wall-clock time, no zone
  "BREAKMIN" integer NULL,            -- NULL = not recorded
  "STATUS" integer NOT NULL,          -- 1 draft, 2 approved, 3 paid
  "IS_ACTIVE" boolean NOT NULL        -- false = soft-deleted
);
```

### 5.2 Synthetic data (`legacy/seed.ts`)

Deterministic: a fixed PRNG seed, so every reset produces identical rows.

Tenants (invented names):

| ID | Name | Time zone | Why |
|---|---|---|---|
| 1 | Harbour Kitchen Group | Pacific/Auckland | observes daylight saving |
| 2 | Sunline Hotels | Australia/Brisbane | no daylight saving (control) |
| 3 | Coral Bay Resort | Pacific/Fiji | different zone, other side of the region |

About 8 employees per tenant, about 5 shifts per employee per week, over two four-week windows chosen to cross the New Zealand clock changes: 23 March to 19 April 2026 and 14 September to 11 October 2026. Roughly 900 to 1,000 shifts. Before relying on those dates, have the seed script assert them against the time-zone database (the offset for Pacific/Auckland must differ between Saturday evening and Sunday morning on 4–5 April 2026 and 26–27 September 2026) and fail loudly if not.

Edge cases the seed must include explicitly, each with a comment in `seed.ts` (comments name the case, not the legacy rule):

- Overnight shift 22:00 to 06:00 across each Auckland clock change
- The same two nights in Brisbane and Fiji
- A shift of exactly 5 h 00 min and one of 5 h 01 min, both with `BREAKMIN` NULL
- `BREAKMIN` = 0 on a long shift
- Durations that land on rounding boundaries (for example 7 h 07 min, 7 h 08 min)
- A draft shift, a soft-deleted shift, an inactive employee with approved historical shifts
- Rates that produce half-cent results before rounding

### 5.3 The original behaviour (`legacy/logic/timesheet.sql`)

A SQL function `legacy.fn_timesheet()` returning one row per payable shift:
`shift_id, tenant_id, employee_id, work_date, paid_hours, gross_pay`.

Rules it implements:

1. Only shifts with `IS_ACTIVE = true` and `STATUS IN (2, 3)`. Employee active flag is ignored (history is still payable).
2. Elapsed time is the **real** elapsed time in the tenant's time zone:
   `("ENDDATETIME" AT TIME ZONE tz) - ("STARTDATETIME" AT TIME ZONE tz)`.
3. Break: recorded `BREAKMIN` if not NULL; otherwise 30 minutes when elapsed is more than 300 minutes, else 0.
4. Paid hours = (elapsed − break), rounded to the nearest quarter hour, half up.
5. Gross pay = paid hours × hourly rate, rounded half up to cents (`numeric`, never float).
6. Work date = the local calendar date the shift **started** on.

### 5.4 What the agent is given (`features/timesheet/brief.md`)

Written the way a business analyst would describe a low-code screen. It includes the legacy DDL, the status codes, that timestamps are stored as local time and each tenant has a time zone, and rules 1, 3, 4, 5 and 6 above. For rule 2 it says only: "Hours worked are the time between the start and the end of the shift." It says nothing about clock changes. This under-specification is realistic and is the point of the demo: the harness, not the document, defines correct.

---

## 6. The new platform and the harness

### 6.1 Target schema (`platform/schema.sql`)

```sql
CREATE SCHEMA app;
CREATE SCHEMA migration;

CREATE TABLE app.tenant   (id uuid PRIMARY KEY, name text NOT NULL, time_zone text NOT NULL);
CREATE TABLE app.employee (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES app.tenant,
                           full_name text NOT NULL, hourly_rate numeric(8,2) NOT NULL, active boolean NOT NULL);
CREATE TYPE  app.shift_status AS ENUM ('draft','approved','paid');
CREATE TABLE app.shift    (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES app.tenant,
                           employee_id uuid NOT NULL REFERENCES app.employee,
                           start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
                           break_minutes integer NULL, status app.shift_status NOT NULL,
                           deleted_at timestamptz NULL);

CREATE TABLE migration.id_map (
  entity text NOT NULL, legacy_id integer NOT NULL, new_id uuid NOT NULL, tenant_id uuid NOT NULL,
  PRIMARY KEY (entity, legacy_id)
);
```

Roles and row-level security:

- `app_owner` owns the tables. `app_user` is the runtime role: not an owner, no `BYPASSRLS`, not superuser. `migrator` is a separate role used only by migration code.
- On `tenant`, `employee` and `shift` (*tenant added in phase A*): `ENABLE` and `FORCE ROW LEVEL SECURITY`, with one policy
  `USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)` and the same `WITH CHECK` (`NULLIF`: a pooled connection reads the setting as `''` after a transaction-local `set_config`, and `''::uuid` raises instead of returning no rows).
- Index `tenant_id` first in composite indexes.

`platform/db.ts` exposes `withTenant(claims, fn)`: opens a transaction as `app_user`, calls `set_config('app.tenant_id', claims['custom:tenant_id'], true)` (transaction-local), runs `fn`, commits. Tenant comes only from verified token claims, never from a function argument supplied by a caller.

`platform/auth.ts` signs and verifies tokens with a local key. Claim shape mirrors a Cognito ID token (`sub`, `custom:tenant_id`, `cognito:groups`). Label it as a stand-in.

### 6.2 What the agent must produce (`features/timesheet/`)

- `mapping.md`: field-by-field mapping, every assumption listed, every open question listed.
- `migrate.ts`: reads `legacy`, writes `app` through the `migrator` role, in dependency order (tenant, employee, shift). New ids are deterministic (UUIDv5 from entity + legacy id) and every row is upserted, so a second run changes nothing. Fills `migration.id_map`.
- `calc.ts`: a pure function plus a query that returns the same row shape as the legacy function (`shift_id` as new id). Money and hours use decimal-safe arithmetic.
- `calc.test.ts`: unit tests for the rules in the brief.

### 6.3 Harness (`harness/run.ts`)

Deterministic. No model calls. Treats the legacy function as a black box (calls it, never reads its source). Exit code is non-zero if any unexplained difference exists.

Checks, in order:

1. **Counts** per tenant per entity: legacy rows in scope vs migrated rows.
2. **Totals** per tenant, and per employee per week (Monday start, by work date): paid hours and gross pay, compared exactly.
3. **Records**: join legacy and new results through `migration.id_map`; compare `work_date`, `paid_hours`, `gross_pay` for every shift; list every mismatch with both values and the inputs.
4. **Isolation** (negative tests through `withTenant`): tenant 1 token sees zero rows of tenant 2; insert with another tenant's id is rejected; no tenant set returns zero rows; `app_user` cannot disable RLS.
5. **Idempotency**: run the migration a second time; counts and a checksum of each table are unchanged.

Output `runs/<nnn>/report.json`:

```json
{
  "run": "001",
  "feature": "timesheet",
  "startedAt": "...", "finishedAt": "...",
  "knowledgeEntriesAtStart": 0,
  "summary": { "checks": 5, "passed": 4, "failed": 1, "recordsCompared": 0, "mismatches": 0 },
  "counts":   [ { "tenant": "...", "entity": "shift", "legacy": 0, "migrated": 0, "ok": true } ],
  "totals":   [ { "tenant": "...", "legacyHours": "0.00", "newHours": "0.00", "legacyGross": "0.00", "newGross": "0.00", "ok": true } ],
  "mismatches": [ { "legacyShiftId": 0, "tenant": "...", "employee": "...", "startLocal": "...", "endLocal": "...",
                    "field": "paid_hours", "legacy": "8.50", "new": "7.50", "triage": null } ],
  "isolation": [ { "name": "...", "ok": true } ],
  "idempotency": { "ok": true }
}
```

Numbers above are placeholders for shape only. Real values come from the run.

`harness/triage.yaml` holds the human decision for each group of mismatches: `new-system-bug`, `legacy-bug-keep`, `legacy-bug-fix` or `acceptable`, with one sentence of reason and who decided. The harness merges it into the next report. Only a human edits this file.

### 6.4 Seeded-fault check (`npm run harness:seeded`)

Proves the harness itself works. It swaps in a deliberately wrong calculation (elapsed time taken as the plain difference of the two local timestamps), runs checks 2 and 3 on its results in memory (no schema is touched), and asserts that the harness reports mismatches on the clock-change nights and nowhere in the Brisbane control tenant. Writes `runs/seeded/report.json` with `"seeded": true`. The page labels this panel "Seeded fault: we broke it on purpose".

---

## 7. The agent's working method

### 7.1 `CLAUDE.md` (keep it short)

- You migrate one feature at a time using the `migrate-feature` skill.
- Read `knowledge/` before anything else. Apply every entry that is relevant and say which ones you applied.
- The harness decides what passes. Never edit `harness/**`, `legacy/**`, `platform/schema.sql` or `harness/triage.yaml`.
- Never weaken or delete a test to make it pass.
- Stop and ask the human when: the harness reports a mismatch; a rule in the brief is ambiguous; anything touches tenancy, RLS, roles or money rounding.
- Money and hours are decimals, never floats. Tenant id comes from token claims only.
- One commit per step, message prefixed with the step name.

### 7.2 Skill: `.claude/skills/migrate-feature/SKILL.md`

Steps, each ending with a commit:

1. **Read**: `knowledge/**`, `features/<name>/brief.md`, legacy DDL, a sample of legacy rows (read-only).
2. **Map**: write `mapping.md` with assumptions and open questions. If any open question affects correctness, stop and ask.
3. **Build**: write `migrate.ts`, `calc.ts`, `calc.test.ts` following `platform/reference/`. Run unit tests.
4. **Migrate**: `npm run db:reset && npm run seed && npm run migrate -- <name>`.
5. **Validate**: `npm run harness -- <name>`. Do not interpret mismatches as acceptable. Summarise them and stop.
6. **After human triage**: fix what was triaged as `new-system-bug`; re-run steps 4 and 5.
7. **Record**: for each lesson, write one file in `knowledge/` (format below). Write `runs/<nnn>/run-notes.md`: what was done, which knowledge entries were applied, what the human decided.

Knowledge entry format (`knowledge/<slug>.md`):

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

### 7.3 The migration guard (`.claude/migration-settings.json`)

*Amended during phase A.* The rules live in a settings file that only the migration session loads (`claude --settings .claude/migration-settings.json`, started by `npm run agent:migrate`), not in `.claude/settings.json`, because a project settings file binds every session and would lock the builder out of `legacy/` and `harness/`.

- Permission deny: read of `legacy/logic/**`, `legacy/seed.ts`, `docs/**`, `harness/seeded-fault.ts`, `harness/seeded/**`, `runs/seeded/**`, `audit/**`, `vitest.private.config.ts`; write of `harness/**`, `legacy/**`, `platform/schema.sql`, `scripts/**`, `.claude/**`; `npm run harness:seeded` and `npm run test:private`; the episodic-memory tools (they can search the builder session's transcript).
- Deny rules are best-effort (the Claude Code docs say so), so a PreToolUse hook (`.claude/hooks/guard.mjs`, patterns in `guard-patterns.json`) also blocks any call whose input names those paths, reads function source from the database (`pg_proc`, `prosrc`, `\sf`), names the legacy function, or reads git history (`git show`, `git log -p`). It fails closed.
- Write protection covers the whole trust base: `harness/`, `legacy/`, `platform/`, `scripts/`, `.claude/`, `package.json` and its lock file, the TypeScript and Vitest configs, `docker-compose.yml`, `CLAUDE.md`. The hook also blocks Bash commands that write to those paths, `npm install` and friends (a new dependency is a stop-and-ask), Grep/Glob searches whose root contains a read-protected folder, and `information_schema.routines`; paths are resolved through symlinks first.
- Feature code runs inside the harness process, which holds the superuser pool, so the harness refuses to load feature code that opens its own connections or reads connection settings (`harness/lib/feature.ts`). It may use only the pool or client it is handed.
- *After run 001:* the launcher makes the trust base read-only at the OS level for the length of the session (`scripts/guard-lock.sh`; unlock between stops to edit `triage.yaml`), headless mode allows only the Bash commands a migration needs (no `docker exec`), stream redirects (`2>&1`, `>/dev/null`) no longer count as writes, and the audit also reads the subagent transcripts. `meta.json` records every call the guard actually stopped, so false positives stay visible.
- Feature tests and the harness execute the agent's own code by design, so no allowlist can stop that code from doing anything the user account can do; the hook's content checks and the transcript audit are what cover it. `fd` and `rg` are not on the headless allowlist (the built-in Grep and Glob tools go through the path checks).
- This is defence in depth, not a sandbox: substring checks on shell text can be evaded on purpose. The transcript audit below is what the honesty claim rests on.
- After the run, `audit/audit-session.ts <transcript.jsonl>` checks the session transcript: no tool result may contain text that exists only in a denied file, and every guarded attempt must have been blocked. Its result goes in the run notes.
- The launcher refuses to start if Claude Code's project memory for this folder is not empty, and uses `--permission-mode default` (bypass mode is never used for the migration session).

### 7.4 `runs/<nnn>/meta.json`

Written by a small script at the end of each run: run number, feature, git commit, wall-clock duration, number of harness runs needed, number of human stops, knowledge entries at start and at end. *Phase A:* `npm run meta -- <feature> <transcript.jsonl>` (`scripts/write-meta.ts`) derives every field from files: the harness reports, `knowledge/`, git, and the session transcript (duration from its timestamps; human stops = human messages after the first). It also records the guard audit of that transcript and exits non-zero if the audit has findings.

---

## 8. The web page

### 8.1 Form

One self-contained static file, `site/dist/index.html`, built by `site/build.ts` from `site/template.html` plus `runs/**`, `features/timesheet/mapping.md`, `knowledge/**` and a small sample of legacy rows. The build inlines all data as JSON in a `<script type="application/json">` block. No network requests at view time except web fonts. Target size under 300 KB. It will be copied into the portfolio site at `/projects/like-for-like/`, so reuse that site's fonts, colours and tone if the portfolio repo is available; otherwise use a quiet editorial style with light and dark themes.

### 8.2 Content

Header: title "Like for like", one sentence ("One feature, migrated by an agent and proven by a harness"), three labels: "Synthetic data", "Real run output", "Tenant token is a local stand-in for Cognito". Link to the repository.

A five-step walkthrough. All steps are in the page and visible by scrolling; a sticky stepper jumps between them. Each step has a `#name` hash.

1. **`#legacy` The original.** The three legacy tables with real sample rows, tenant time zones, and the brief as the agent received it.
2. **`#agent` The agent's method.** The skill's seven steps, the guardrails from `CLAUDE.md`, and what the agent produced: the mapping table and its list of assumptions and open questions (from `mapping.md`).
3. **`#run-1` First validation run.** The five checks as pass/fail rows. Totals per tenant, legacy vs new. If there are mismatches: the record-level table with both values, grouped by tenant, with the Brisbane tenant visible as the clean control. If run 001 passed outright, show that truthfully and move the weight to the seeded-fault panel.
4. **`#decision` The human decision.** The triage entry (who, what, why) and the knowledge entry written from it, shown as a card with its Rule, Why and Check.
5. **`#run-2` Second run.** All checks green, same totals table, plus the isolation tests listed one by one and the idempotency result. Small figures from `meta.json`: harness runs needed, human stops, knowledge entries before and after.

Then two panels:

- **Seeded fault.** From `runs/seeded/report.json`, labelled as deliberate.
- *Stretch:* **Second feature.** Run numbers for the second feature next to the first: human stops, harness runs, which knowledge entries were applied.

Footer: what this demo is not (section 1 non-goals, in one short paragraph), repository link, contact.

### 8.3 Behaviour and quality

- Works without JavaScript for reading; JavaScript only adds the stepper, table filtering by tenant and expanding a mismatch row to show its inputs.
- Status is shown by text and shape as well as colour (Pass / Fail / Seeded pills).
- Phone width first: tables scroll inside their own container; numbers use tabular figures.
- Keyboard focus visible; respects reduced motion.
- No claims in prose that the data does not support. Every number on the page is read from a file in `runs/`.

---

## 9. Plan

### Phase A: scaffold (builder session), Saturday

1. Repo, Docker, npm scripts.
2. Legacy schema, seed with the edge cases, legacy function. Assert the clock-change dates.
3. Platform schema, roles, RLS, `withTenant`, stand-in tokens, a tiny reference example.
4. Harness with all five checks, `triage.yaml`, seeded-fault check.
5. `CLAUDE.md`, skill, settings with the deny rule, empty `knowledge/` with its README, `features/timesheet/brief.md`.

Done when: `npm run db:reset && npm run seed` gives identical data twice; `npm run harness:seeded` reports mismatches only on clock-change nights in the Auckland tenant; isolation tests pass against an empty `app` schema; a fresh session is refused when it tries to read `legacy/logic/timesheet.sql` or `docs/DESIGN_AND_PLAN.md`. Builder sessions are started normally and are not affected by the guard; the guard is verified with a fresh `claude -p --settings .claude/migration-settings.json` session whose transcript passes `audit/audit-session.ts`.

### Phase B: the migration (fresh migration session), Saturday evening or Sunday morning

1. Start the session with `npm run agent:migrate` (a fresh session with the guard loaded; its only prompt is "Use the migrate-feature skill to migrate the timesheet feature.").
2. Let it run to its first stop. Save run 001.
3. Human triage in `triage.yaml`. Let it continue. Save run 002.
4. Commit everything, including the run notes exactly as written.

Done when: the final harness run exits zero, and `runs/` holds an honest record of what happened.

### Phase C: page and README (builder session), Sunday

1. `site/build.ts` and the template, built from the real run files.
2. README: what it is, a diagram of the loop, how to run it in three commands, the honesty labels, what is out of scope.
3. Check the page on a phone and in dark mode. Read every sentence on it against the run files.

### Stretch (only if A to C are done)

- Second feature, `clock-events` (clock-in and clock-out pairs turned into shifts), migrated in a fresh session that starts with the knowledge base from the first feature.
- A legacy quirk that should be triaged as `legacy-bug-keep`, to show that kind of decision.
- A shift whose local end time falls in the repeated hour of a clock change, triaged as a question for the product owner.

*Done after phase C:* the three stretch items are one second feature. `clock-events` pairs clock-in and clock-out events into shifts and pays them with the timesheet rules. Its legacy logic keeps whole minutes only (seconds are dropped before computing): a quirk to triage as `legacy-bug-keep`. Its data has a clock-out at a local time that occurs twice (Auckland, 5 April 2026, 02:30), which PostgreSQL reads as the later instant while the first feature's knowledge says the earlier one: a question for the product owner. Harness, migrate runner and counts take the feature from a registry (`harness/features/index.ts`); `clock-events` depends on `timesheet` for tenants and employees.

### Monday morning

Publish the page under the portfolio site, make the repository public, send the link.

---

## 10. Acceptance checklist

- [ ] Three commands from a clean clone reproduce the final report
- [ ] No real company, client or person named anywhere
- [ ] The migration session never read `legacy/logic/**` or `docs/**` (deny rule verified)
- [ ] Harness contains no model calls and exits non-zero on unexplained differences
- [ ] `app_user` cannot read across tenants; proven by tests in the report
- [ ] Migration can run twice with no change
- [ ] Every number on the page traces to a file in `runs/`
- [ ] Page carries the three labels: synthetic data, real run output, stand-in token
- [ ] Seeded-fault panel is labelled as deliberate
