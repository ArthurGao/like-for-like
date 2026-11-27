// Clock events: pair each clock-in with the employee's next event when it is a clock-out, and
// compute work date, paid hours and gross pay per pair. The query only feeds rows; pairing and
// arithmetic are pure functions (the pay rules are the timesheet's computePay, no break recorded).
import type pg from 'pg';
import { DateTime } from 'luxon';
import type { VerifiedClaims } from '../../platform/auth.ts';
import type { CalculateFn, ClockShiftRow } from '../../harness/contracts.ts';
import { computePay } from '../timesheet/calc.ts';

export type ClockEventType = 'in' | 'out';

export type ClockEventInput = {
  id: string;
  tenantId: string;
  employeeId: string;
  eventType: ClockEventType;
  occurredAt: string; // ISO instant
  deleted: boolean;
  timeZone: string; // tenant IANA zone
  hourlyRate: string; // employee rate, two-decimal text
};

export type ClockPair = { clockIn: ClockEventInput; clockOut: ClockEventInput };

/**
 * Rules 1-2: drop deleted events, order each employee's events by instant (ties by id), and
 * pair a clock-in with the next event when that is a clock-out. Anything else is not paid.
 */
export function pairEvents(events: readonly ClockEventInput[]): ClockPair[] {
  const live = events
    .filter((e) => !e.deleted)
    .map((e) => ({ e, ms: toMillis(e.occurredAt) }))
    .sort(
      (a, b) =>
        compare(a.e.employeeId, b.e.employeeId) || a.ms - b.ms || compare(a.e.id, b.e.id),
    )
    .map((x) => x.e);

  const pairs: ClockPair[] = [];
  for (let i = 0; i + 1 < live.length; i++) {
    const cur = live[i]!;
    const next = live[i + 1]!;
    if (cur.eventType === 'in' && next.eventType === 'out' && next.employeeId === cur.employeeId) {
      pairs.push({ clockIn: cur, clockOut: next });
    }
  }
  return pairs;
}

/** Rules 3-6 for every pair; a pair that cannot be paid fails with an error naming its clock-in. */
export function clockShiftRows(events: readonly ClockEventInput[]): ClockShiftRow[] {
  return pairEvents(events).map(({ clockIn, clockOut }) => {
    try {
      return {
        clock_in_id: clockIn.id,
        tenant_id: clockIn.tenantId,
        employee_id: clockIn.employeeId,
        // Triage clock-minutes-only (run 003, legacy-bug-keep): terminals are paid at whole-minute
        // precision, so the seconds of both times are dropped before computing. Pairing above
        // still orders by the exact time.
        ...computePay({
          startAt: wholeMinute(clockIn.occurredAt, clockIn.timeZone),
          endAt: wholeMinute(clockOut.occurredAt, clockIn.timeZone),
          timeZone: clockIn.timeZone,
          breakMinutes: null, // terminals record no break: 30 min when worked is over 5 h
          hourlyRate: clockIn.hourlyRate,
        }),
      };
    } catch (err) {
      throw new Error(`clock-in ${clockIn.id}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
  });
}

export const calculate: CalculateFn<ClockShiftRow> = async (client: pg.PoolClient, claims: VerifiedClaims) => {
  const { rows } = await client.query<ClockEventInput>(
    `SELECT c.id::text AS id, c.tenant_id::text AS "tenantId", c.employee_id::text AS "employeeId",
            c.event_type::text AS "eventType",
            to_char(c.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "occurredAt",
            c.deleted_at IS NOT NULL AS deleted, t.time_zone AS "timeZone", e.hourly_rate::text AS "hourlyRate"
       FROM app.clock_event c
       JOIN app.employee e ON e.id = c.employee_id AND e.tenant_id = c.tenant_id
       JOIN app.tenant t ON t.id = c.tenant_id
      WHERE c.tenant_id = $1`, // no ORDER BY: pairEvents orders the events
    [claims['custom:tenant_id']],
  );
  return clockShiftRows(rows);
};

function toMillis(iso: string): number {
  const dt = DateTime.fromISO(iso, { setZone: true });
  if (!dt.isValid) throw new Error(`not a valid instant: ${iso} (${dt.invalidExplanation})`);
  return dt.toMillis();
}

/** The instant truncated to the start of its local minute in the tenant zone, as an ISO instant. */
function wholeMinute(iso: string, zone: string): string {
  const dt = DateTime.fromISO(iso, { zone });
  if (!dt.isValid) throw new Error(`not a valid instant in ${zone}: ${iso} (${dt.invalidExplanation})`);
  return dt.startOf('minute').toUTC().toISO()!;
}

const compare =(a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
