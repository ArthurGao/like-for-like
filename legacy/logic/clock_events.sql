-- The ORIGINAL behaviour of the clock-events screen. Black box to the migration agent.
-- Pairs each clock-in with the employee's next event when that is a clock-out, then pays the
-- pair with the timesheet rules (no break is recorded at a terminal, so the default applies).
CREATE FUNCTION legacy.fn_clock_timesheet()
RETURNS TABLE (
  clock_in_id integer,
  tenant_id integer,
  employee_id integer,
  work_date date,
  paid_hours numeric(6,2),
  gross_pay numeric(10,2)
)
LANGUAGE sql STABLE
AS $$
  WITH ev AS (
    SELECT c."ID" AS id, c."TENANTID" AS tenant_id, c."EMPLOYEEID" AS employee_id, c."EVENTTYPE" AS typ,
           c."EVENTDATETIME" AS at_local,
           -- Quirk: the legacy screen keeps whole minutes only (seconds are dropped).
           date_trunc('minute', c."EVENTDATETIME") AS at_minute,
           lead(c."EVENTTYPE") OVER w AS next_typ,
           lead(date_trunc('minute', c."EVENTDATETIME")) OVER w AS next_minute
      FROM legacy."OSUSR_A1B_CLOCKEVENT" c
     WHERE c."IS_ACTIVE"
    WINDOW w AS (PARTITION BY c."EMPLOYEEID" ORDER BY c."EVENTDATETIME", c."ID")
  ),
  pairs AS (
    SELECT e.id, e.tenant_id, e.employee_id, e.at_local::date AS work_date, emp."HOURLYRATE" AS rate,
           -- Real elapsed time in the tenant's zone. An ambiguous local time resolves the way
           -- PostgreSQL resolves it (the later instant).
           EXTRACT(EPOCH FROM (e.next_minute AT TIME ZONE t."TIMEZONE")
                            - (e.at_minute AT TIME ZONE t."TIMEZONE")) / 60 AS elapsed_min
      FROM ev e
      JOIN legacy."OSUSR_A1B_TENANT" t ON t."ID" = e.tenant_id
      JOIN legacy."OSUSR_A1B_EMPLOYEE" emp ON emp."ID" = e.employee_id
     WHERE e.typ = 1 AND e.next_typ = 2
  ),
  paid AS (
    SELECT p.*, ROUND((p.elapsed_min - CASE WHEN p.elapsed_min > 300 THEN 30 ELSE 0 END) / 15) * 0.25 AS hours
      FROM pairs p
  )
  SELECT id, tenant_id, employee_id, work_date, hours::numeric(6,2), ROUND(hours * rate, 2)::numeric(10,2)
    FROM paid
   ORDER BY id
$$;

REVOKE ALL ON FUNCTION legacy.fn_clock_timesheet() FROM PUBLIC;
