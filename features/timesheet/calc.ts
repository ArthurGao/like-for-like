// Timesheet: one row per payable shift with work date, paid hours and gross pay.
// The query only feeds rows; computePay does the arithmetic on integers (BigInt), never floats.
import type pg from 'pg';
import { DateTime } from 'luxon';
import type { VerifiedClaims } from '../../platform/auth.ts';
import type { CalculateFn, TimesheetRow } from '../../harness/contracts.ts';

export type ShiftStatus = 'draft' | 'approved' | 'paid';

export type PayInput = {
  startAt: string; // ISO instant
  endAt: string; // ISO instant
  timeZone: string; // tenant IANA zone
  breakMinutes: number | null; // null = not recorded
  hourlyRate: string; // two-decimal text
};

const MS_PER_MINUTE = 60_000n;
const QUARTER_MS = 15n * MS_PER_MINUTE;
const DEFAULT_BREAK_MS = 30n * MS_PER_MINUTE;
const DEFAULT_BREAK_AFTER_MS = 5n * 60n * MS_PER_MINUTE;

/** Rule 1: not deleted, and approved or paid. Employee activity does not matter. */
export function isPayable(s: { status: ShiftStatus; deleted: boolean }): boolean {
  return !s.deleted && (s.status === 'approved' || s.status === 'paid');
}

/** Rules 2-6 for one shift. */
export function computePay(input: PayInput): Pick<TimesheetRow, 'work_date' | 'paid_hours' | 'gross_pay'> {
  const start = instant(input.startAt, input.timeZone);
  const end = instant(input.endAt, input.timeZone);

  // Rule 2: real elapsed time between the two instants.
  const workedMs = BigInt(end.toMillis() - start.toMillis());
  // Rule 3: a recorded break (0 included) wins; otherwise 30 min when worked is over 5 h.
  const breakMs =
    input.breakMinutes !== null
      ? BigInt(input.breakMinutes) * MS_PER_MINUTE
      : workedMs > DEFAULT_BREAK_AFTER_MS
        ? DEFAULT_BREAK_MS
        : 0n;
  // Decision D2 (run 001): negative paid time is a data error, never a negative payment.
  const paidMs = workedMs - breakMs;
  if (paidMs < 0n) {
    throw new Error(`negative paid time (${Number(paidMs) / 60_000} min), refusing to pay it`);
  }
  // Rule 4: nearest quarter hour, half up.
  const quarters = roundHalfUp(paidMs, QUARTER_MS);
  // Rule 5: quarters * rate in cents / 4, half a cent up.
  const grossCents = roundHalfUp(quarters * cents(input.hourlyRate), 4n);

  return {
    work_date: start.toISODate()!, // Rule 6: local date of the start
    paid_hours: formatHundredths(quarters * 25n),
    gross_pay: formatHundredths(grossCents),
  };
}

export type ShiftRow = PayInput & Pick<TimesheetRow, 'shift_id' | 'tenant_id' | 'employee_id'>;

/** One payable shift -> its TimesheetRow; a refused shift fails with an error naming it. */
export function timesheetRow(r: ShiftRow): TimesheetRow {
  try {
    return { shift_id: r.shift_id, tenant_id: r.tenant_id, employee_id: r.employee_id, ...computePay(r) };
  } catch (err) {
    throw new Error(`shift ${r.shift_id}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

export const calculate: CalculateFn = async (client: pg.PoolClient, claims: VerifiedClaims) => {
  const { rows } = await client.query<ShiftRow & { status: ShiftStatus; deleted: boolean }>(
    `SELECT s.id::text AS shift_id, s.tenant_id::text AS tenant_id, s.employee_id::text AS employee_id,
            to_char(s.start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "startAt",
            to_char(s.end_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "endAt",
            t.time_zone AS "timeZone", s.break_minutes AS "breakMinutes", e.hourly_rate::text AS "hourlyRate",
            s.status::text AS status, s.deleted_at IS NOT NULL AS deleted
       FROM app.shift s
       JOIN app.employee e ON e.id = s.employee_id AND e.tenant_id = s.tenant_id
       JOIN app.tenant t ON t.id = s.tenant_id
      WHERE s.tenant_id = $1
      ORDER BY s.start_at, s.id`,
    [claims['custom:tenant_id']],
  );
  return rows.filter(isPayable).map(timesheetRow);
};

function instant(iso: string, zone: string): DateTime {
  const dt = DateTime.fromISO(iso, { zone });
  if (!dt.isValid) throw new Error(`not a valid instant in ${zone}: ${iso} (${dt.invalidExplanation})`);
  return dt;
}

function cents(amount: string): bigint {
  if (!/^-?\d+\.\d{2}$/.test(amount)) throw new Error(`not a money amount: ${amount}`);
  return BigInt(amount.replace('.', ''));
}

/** n / d rounded to the nearest integer, exactly half towards +infinity. d > 0. */
function roundHalfUp(n: bigint, d: bigint): bigint {
  const num = 2n * n + d;
  const den = 2n * d;
  const q = num / den; // truncates towards zero
  return num % den !== 0n && num < 0n ? q - 1n : q;
}

/** 725n -> "7.25", -5n -> "-0.05" */
function formatHundredths(v: bigint): string {
  const sign = v < 0n ? '-' : '';
  const abs = v < 0n ? -v : v;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}
