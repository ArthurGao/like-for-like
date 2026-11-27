// Deterministic synthetic data for the legacy tables. Every run produces identical rows.
// All names are invented.
import { DateTime } from 'luxon';
import type pg from 'pg';
import { runMain } from '../platform/cli.ts';
import { adminPool } from '../platform/db.ts';

const SEED = 20260404;

// mulberry32: small, fixed PRNG so the data does not depend on Math.random.
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = prng(SEED);
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]!;

const TENANTS = [
  { id: 1, name: 'Harbour Kitchen Group', tz: 'Pacific/Auckland' },
  { id: 2, name: 'Sunline Hotels', tz: 'Australia/Brisbane' },
  { id: 3, name: 'Coral Bay Resort', tz: 'Pacific/Fiji' },
] as const;

const WINDOWS = [
  { from: '2026-03-23', to: '2026-04-19', status: 3 }, // earlier window: mostly paid
  { from: '2026-09-14', to: '2026-10-11', status: 2 }, // later window: mostly approved
] as const;

// Nights on which Pacific/Auckland changes its clocks (evening date of the night).
const CHANGE_NIGHTS = ['2026-04-04', '2026-09-26'] as const;

const FIRST = ['Aroha', 'Ben', 'Carys', 'Dev', 'Eli', 'Fetu', 'Grace', 'Hemi', 'Isla', 'Jonah',
  'Kiri', 'Lena', 'Mateo', 'Nina', 'Oscar', 'Priya', 'Quinn', 'Rua', 'Sione', 'Tama', 'Uma', 'Vika',
  'Wiremu', 'Xin', 'Yusuf', 'Zara'] as const;
const LAST = ['Ashdown', 'Brightwater', 'Calloway', 'Dunmore', 'Everleigh', 'Fairbank', 'Glenholm',
  'Hartwell', 'Inglewood', 'Kestrel', 'Larchmont', 'Marlow', 'Northcote', 'Oakridge', 'Pemberly',
  'Redcliffe', 'Stonebridge', 'Thornbury', 'Wexley'] as const;

type Employee = { id: number; tenantId: number; name: string; rate: string; active: boolean };
type Shift = {
  id: number; tenantId: number; employeeId: number; start: string; end: string;
  breakMin: number | null; status: number; active: boolean;
};

const WALL = 'yyyy-MM-dd HH:mm:ss';
// Wall-clock arithmetic only: UTC is used as a zone with no clock changes.
const wall = (date: string, time: string) => DateTime.fromISO(`${date}T${time}`, { zone: 'UTC' });

function assertClockChangeNights() {
  for (const night of CHANGE_NIGHTS) {
    const evening = DateTime.fromISO(`${night}T20:00`, { zone: 'Pacific/Auckland' });
    const morning = evening.plus({ hours: 12 });
    if (!evening.isValid || evening.offset === morning.offset) {
      throw new Error(`time-zone database: Pacific/Auckland does not change offset on ${night}`);
    }
    for (const tz of ['Australia/Brisbane', 'Pacific/Fiji']) {
      const e = DateTime.fromISO(`${night}T20:00`, { zone: tz });
      if (e.offset !== e.plus({ hours: 12 }).offset) {
        throw new Error(`time-zone database: ${tz} changes offset on ${night}; control is broken`);
      }
    }
  }
}

function build() {
  const employees: Employee[] = [];
  const shifts: Shift[] = [];
  let shiftId = 1;
  const addShift = (s: Omit<Shift, 'id'>) => shifts.push({ id: shiftId++, ...s });

  for (const t of TENANTS) {
    for (let i = 0; i < 8; i++) {
      const cents = int(2350, 3890);
      employees.push({
        id: t.id * 100 + i + 1,
        tenantId: t.id,
        name: `${pick(FIRST)} ${pick(LAST)}`,
        // Employee 2 of each tenant: a rate that produces half-cent results before rounding.
        rate: i === 1 ? '25.10' : (cents / 100).toFixed(2),
        // Employee 8 of each tenant: inactive now, with approved historical shifts.
        active: i !== 7,
      });
    }
  }

  // Regular shifts: about five a week per employee, daytime only.
  for (const w of WINDOWS) {
    const last = wall(w.to, '00:00');
    for (let d = wall(w.from, '00:00'); d <= last; d = d.plus({ days: 1 })) {
      for (const e of employees) {
        if (rand() >= 5 / 7) continue;
        const startMin = int(6, 13) * 60 + (rand() < 0.7 ? pick([0, 15, 30, 45]) : int(0, 59));
        const start = d.plus({ minutes: startMin });
        const end = start.plus({ minutes: int(180, 600) });
        const r = rand();
        addShift({
          tenantId: e.tenantId,
          employeeId: e.id,
          start: start.toFormat(WALL),
          end: end.toFormat(WALL),
          breakMin: r < 0.55 ? null : r < 0.85 ? 30 : pick([0, 15, 45, 60]),
          status: rand() < 0.06 ? 1 : w.status,
          active: rand() >= 0.03,
        });
      }
    }
  }

  const emp = (tenantId: number, n: number) => employees.find((e) => e.id === tenantId * 100 + n)!;
  const edge = (e: Employee, start: string, end: string, breakMin: number | null,
    extra: Partial<Pick<Shift, 'status' | 'active'>> = {}) =>
    addShift({ tenantId: e.tenantId, employeeId: e.id, start, end, breakMin,
      status: extra.status ?? 2, active: extra.active ?? true });

  // Edge case: overnight shift 22:00 to 06:00 across each Auckland clock change (two staff).
  for (const night of CHANGE_NIGHTS) {
    const next = wall(night, '00:00').plus({ days: 1 }).toISODate()!;
    edge(emp(1, 3), `${night} 22:00:00`, `${next} 06:00:00`, null);
    edge(emp(1, 4), `${night} 22:00:00`, `${next} 06:00:00`, null);
    // Edge case: the same nights in Brisbane and Fiji.
    edge(emp(2, 3), `${night} 22:00:00`, `${next} 06:00:00`, null);
    edge(emp(3, 3), `${night} 22:00:00`, `${next} 06:00:00`, null);
  }
  for (const t of TENANTS) {
    // Edge case: exactly 5 h 00 min and 5 h 01 min, break not recorded.
    edge(emp(t.id, 5), '2026-03-25 09:00:00', '2026-03-25 14:00:00', null);
    edge(emp(t.id, 5), '2026-03-26 09:00:00', '2026-03-26 14:01:00', null);
    // Edge case: break recorded as 0 on a long shift.
    edge(emp(t.id, 6), '2026-03-27 07:00:00', '2026-03-27 18:00:00', 0);
    // Edge case: durations on rounding boundaries (7 h 07, 7 h 07 m 30 s, 7 h 08).
    edge(emp(t.id, 6), '2026-09-15 08:00:00', '2026-09-15 15:07:00', 0);
    edge(emp(t.id, 6), '2026-09-16 08:00:00', '2026-09-16 15:07:30', 0);
    edge(emp(t.id, 6), '2026-09-17 08:00:00', '2026-09-17 15:08:00', 0);
    // Edge case: half-cent result before rounding (rate 25.10, 7 h 15 paid).
    edge(emp(t.id, 2), '2026-09-18 08:00:00', '2026-09-18 15:15:00', 0);
    // Edge case: a draft shift, and a soft-deleted shift.
    edge(emp(t.id, 1), '2026-09-21 09:00:00', '2026-09-21 17:00:00', 30, { status: 1 });
    edge(emp(t.id, 1), '2026-09-22 09:00:00', '2026-09-22 17:00:00', 30, { active: false });
    // Edge case: inactive employee with approved historical shifts.
    edge(emp(t.id, 8), '2026-03-24 10:00:00', '2026-03-24 16:30:00', null, { status: 3 });
    edge(emp(t.id, 8), '2026-03-31 10:00:00', '2026-03-31 16:30:00', null, { status: 2 });
  }
  return { employees, shifts };
}

async function insert(db: pg.ClientBase, table: string, cols: string[], rows: unknown[][]) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const values = chunk
      .map((_, r) => `(${cols.map((_, c) => `$${r * cols.length + c + 1}`).join(', ')})`)
      .join(', ');
    await db.query(
      `INSERT INTO legacy."${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES ${values}`,
      chunk.flat(),
    );
  }
}

runMain(async () => {
  assertClockChangeNights();
  const { employees, shifts } = build();
  const db = await adminPool().connect();
  await db.query('BEGIN');
  try {
    await db.query(`TRUNCATE legacy."OSUSR_A1B_SHIFT", legacy."OSUSR_A1B_EMPLOYEE", legacy."OSUSR_A1B_TENANT"`);
    await insert(db, 'OSUSR_A1B_TENANT', ['ID', 'NAME', 'TIMEZONE'], TENANTS.map((t) => [t.id, t.name, t.tz]));
    await insert(db, 'OSUSR_A1B_EMPLOYEE', ['ID', 'TENANTID', 'FULLNAME', 'HOURLYRATE', 'IS_ACTIVE'],
      employees.map((e) => [e.id, e.tenantId, e.name, e.rate, e.active]));
    await insert(db, 'OSUSR_A1B_SHIFT',
      ['ID', 'TENANTID', 'EMPLOYEEID', 'STARTDATETIME', 'ENDDATETIME', 'BREAKMIN', 'STATUS', 'IS_ACTIVE'],
      shifts.map((s) => [s.id, s.tenantId, s.employeeId, s.start, s.end, s.breakMin, s.status, s.active]));
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    db.release();
  }
  console.log(`seed: ${TENANTS.length} tenants, ${employees.length} employees, ${shifts.length} shifts`);
});
