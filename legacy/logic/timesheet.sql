-- The ORIGINAL behaviour. Black box to the migration agent (read access denied).
-- One row per payable shift.
CREATE FUNCTION legacy.fn_timesheet()
RETURNS TABLE (
  shift_id integer,
  tenant_id integer,
  employee_id integer,
  work_date date,
  paid_hours numeric(6,2),
  gross_pay numeric(10,2)
)
LANGUAGE sql STABLE
AS $$
  WITH payable AS (
    SELECT s."ID" AS shift_id,
           s."TENANTID" AS tenant_id,
           s."EMPLOYEEID" AS employee_id,
           s."STARTDATETIME"::date AS work_date,
           s."BREAKMIN" AS break_min,
           e."HOURLYRATE" AS rate,
           -- Real elapsed time: both wall-clock values interpreted in the tenant's zone.
           EXTRACT(EPOCH FROM (s."ENDDATETIME" AT TIME ZONE t."TIMEZONE")
                            - (s."STARTDATETIME" AT TIME ZONE t."TIMEZONE")) / 60 AS elapsed_min
      FROM legacy."OSUSR_A1B_SHIFT" s
      JOIN legacy."OSUSR_A1B_EMPLOYEE" e ON e."ID" = s."EMPLOYEEID"
      JOIN legacy."OSUSR_A1B_TENANT" t ON t."ID" = s."TENANTID"
     WHERE s."IS_ACTIVE" AND s."STATUS" IN (2, 3)   -- employee active flag ignored on purpose
  ),
  with_break AS (
    SELECT p.*,
           COALESCE(p.break_min, CASE WHEN p.elapsed_min > 300 THEN 30 ELSE 0 END) AS break_used
      FROM payable p
  ),
  hours AS (
    -- Nearest quarter hour; numeric ROUND is half away from zero, i.e. half up for positives.
    SELECT w.*, ROUND((w.elapsed_min - w.break_used) / 15) * 0.25 AS paid
      FROM with_break w
  )
  SELECT h.shift_id, h.tenant_id, h.employee_id, h.work_date,
         h.paid::numeric(6,2),
         ROUND(h.paid * h.rate, 2)::numeric(10,2)
    FROM hours h
   ORDER BY h.shift_id
$$;

REVOKE ALL ON FUNCTION legacy.fn_timesheet() FROM PUBLIC;
