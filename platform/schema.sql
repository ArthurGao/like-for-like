-- Target model: multi-tenant, isolated by row-level security.
-- Runs as the superuser after the roles exist (scripts/db-reset.ts creates them).
--   app_owner  owns the tables (NOLOGIN)
--   app_user   runtime role: not an owner, no BYPASSRLS, not superuser
--   migrator   migration code only: reads legacy, writes app and migration

CREATE SCHEMA app AUTHORIZATION app_owner;
CREATE SCHEMA migration AUTHORIZATION app_owner;

SET ROLE app_owner;

CREATE TABLE app.tenant (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  time_zone text NOT NULL
);

CREATE TABLE app.employee (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenant,
  full_name text NOT NULL,
  hourly_rate numeric(8,2) NOT NULL,
  active boolean NOT NULL,
  UNIQUE (tenant_id, id)
);

CREATE TYPE app.shift_status AS ENUM ('draft', 'approved', 'paid');

CREATE TABLE app.shift (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenant,
  employee_id uuid NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  break_minutes integer NULL,
  status app.shift_status NOT NULL,
  deleted_at timestamptz NULL,
  -- A shift and its employee always belong to the same tenant (decision after run 001).
  FOREIGN KEY (tenant_id, employee_id) REFERENCES app.employee (tenant_id, id)
);

CREATE TYPE app.clock_event_type AS ENUM ('in', 'out');

CREATE TABLE app.clock_event (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenant,
  employee_id uuid NOT NULL,
  event_type app.clock_event_type NOT NULL,
  occurred_at timestamptz NOT NULL,
  deleted_at timestamptz NULL,
  FOREIGN KEY (tenant_id, employee_id) REFERENCES app.employee (tenant_id, id)
);

CREATE INDEX employee_tenant_idx ON app.employee (tenant_id, id);
CREATE INDEX clock_event_tenant_employee_idx ON app.clock_event (tenant_id, employee_id, occurred_at);
CREATE INDEX shift_tenant_employee_idx ON app.shift (tenant_id, employee_id, start_at);

CREATE TABLE migration.id_map (
  entity text NOT NULL,
  legacy_id integer NOT NULL,
  new_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  PRIMARY KEY (entity, legacy_id)
);

-- The tenant of the current transaction, set by withTenant. NULL when none is set.
-- NULLIF: after a transaction-local set_config ends, a pooled connection reads the setting
-- as '' (not NULL); casting '' to uuid would raise instead of returning no rows.
CREATE FUNCTION app.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- Row-level security. FORCE makes the policies apply to the table owner too.
ALTER TABLE app.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.tenant
  USING (id = app.current_tenant_id()) WITH CHECK (id = app.current_tenant_id());

ALTER TABLE app.employee ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.employee FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.employee
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE app.shift ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.shift FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.shift
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE app.clock_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.clock_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.clock_event
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());

RESET ROLE;

-- Runtime role: tenant-scoped reads and writes, nothing in legacy or migration.
GRANT USAGE ON SCHEMA app TO app_user;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO app_user, migrator;
GRANT SELECT ON app.tenant TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.employee, app.shift, app.clock_event TO app_user;

-- Migration role: BYPASSRLS (set on the role) because it writes every tenant.
GRANT USAGE ON SCHEMA app, migration, legacy TO migrator;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO migrator;
GRANT SELECT, INSERT, UPDATE, DELETE ON migration.id_map TO migrator;
GRANT SELECT ON ALL TABLES IN SCHEMA legacy TO migrator;
