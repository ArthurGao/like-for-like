-- Legacy tables, named the way a low-code platform generates them.
CREATE SCHEMA legacy;

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
  "STARTDATETIME" timestamp NOT NULL, -- local wall-clock time, no zone
  "ENDDATETIME" timestamp NOT NULL,   -- local wall-clock time, no zone
  "BREAKMIN" integer NULL,            -- NULL = not recorded
  "STATUS" integer NOT NULL,          -- 1 draft, 2 approved, 3 paid
  "IS_ACTIVE" boolean NOT NULL        -- false = soft-deleted
);
