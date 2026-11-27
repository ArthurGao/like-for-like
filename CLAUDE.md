# like-for-like

A demo: one legacy feature is migrated to a new multi-tenant platform, a deterministic
harness compares legacy and new results, and a human decides what each difference means.
All data is synthetic.

## Your job

- You migrate one feature at a time using the `migrate-feature` skill.
- Read `knowledge/` before anything else. Apply every entry that is relevant and say which
  ones you applied.
- The harness decides what passes. Never edit `harness/**`, `legacy/**`,
  `platform/schema.sql` or `harness/triage.yaml`.
- Never weaken or delete a test to make it pass.
- Stop and ask the human when: the harness reports a mismatch; a rule in the brief is
  ambiguous; anything touches tenancy, RLS, roles or money rounding.
- Money and hours are decimals, never floats. Tenant id comes from token claims only.
- One commit per step, message prefixed with the step name.

## Where things are

- `features/<name>/brief.md`: what the feature does. Your outputs go next to it
  (`mapping.md`, `migrate.ts`, `calc.ts`, `calc.test.ts`).
- `legacy/schema.sql`: legacy tables (read-only).
- `platform/`: target schema, `db.ts` (`withTenant(claims, fn)`), `auth.ts`
  (local stand-in for Cognito tokens), `reference/` (how code looks here: follow it).
- `knowledge/`: lessons from earlier runs; `knowledge/README.md` gives the entry format.
- `runs/<nnn>/`: harness reports and run notes.

## Stack and commands

Node 20+, TypeScript strict, npm, PostgreSQL 16 in Docker, `pg` (no ORM, plain `.sql`),
`luxon`, `jose`, `vitest`, `tsx`.

```
npm run db:up                    # start Postgres
npm run db:reset && npm run seed # fresh, deterministic data
npm run migrate -- <feature>
npm run harness -- <feature>     # non-zero exit = unexplained differences
npm run legacy:sample            # a few legacy rows per tenant (read-only)
npm test && npm run typecheck
```
