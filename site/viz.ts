// Data for the page's moving pictures, all derived from the database and the run files.
import { DateTime } from 'luxon';
import type pg from 'pg';

/** Every record the harness compares for a feature, in tenant then id order. */
export type Grid = { tenant: string; ids: number[] }[];

export async function legacyGrid(admin: pg.Pool | pg.ClientBase, fn: string, idColumn: string): Promise<Grid> {
  const { rows } = await admin.query<{ id: number; tenant: string }>(
    `SELECT f.${idColumn} AS id, t."NAME" AS tenant
       FROM legacy.${fn}() f JOIN legacy."OSUSR_A1B_TENANT" t ON t."ID" = f.tenant_id
      ORDER BY t."ID", f.${idColumn}`,
  );
  const grid: Grid = [];
  for (const r of rows) {
    const last = grid.at(-1);
    if (last?.tenant === r.tenant) last.ids.push(r.id);
    else grid.push({ tenant: r.tenant, ids: [r.id] });
  }
  return grid;
}

/** One harness run as the grid animation shows it. */
export type RunViz = {
  key: string;
  label: string;
  feature: string;
  compared: number;
  /** legacy record id -> the triage decision it got, or "" when it has none */
  mismatches: Record<number, string>;
  caption: string;
};

/** A night when the wall clock and real time part, as instants and the offset change between them. */
export type Night = {
  key: string;
  label: string;
  timeZone: string;
  startLocal: string;
  endLocal: string;
  startMs: number;
  endMs: number;
  /** Instant the offset changes, with the offsets (minutes) before and after; null if none. */
  change: { atMs: number; before: number; after: number } | null;
  /** For a local time that occurs twice: the earlier reading of the end. */
  altEndMs: number | null;
  outcome: string;
};

const offsetAt = (ms: number, zone: string) => DateTime.fromMillis(ms, { zone }).offset;

/** First instant (to the minute) in [a, b] where the zone's offset differs from its offset at a. */
function findChange(a: number, b: number, zone: string): number | null {
  if (offsetAt(a, zone) === offsetAt(b, zone)) return null;
  let lo = a;
  let hi = b;
  while (hi - lo > 60_000) {
    const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
    if (offsetAt(mid, zone) === offsetAt(a, zone)) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * `endReading`: which instant a repeated local end time means ('earlier' or 'later'); the other
 * reading is kept as altEndMs so the page can show both.
 */
export function night(o: { key: string; label: string; timeZone: string; startLocal: string; endLocal: string;
  endReading?: 'earlier' | 'later'; outcome: string }): Night {
  const start = DateTime.fromSQL(o.startLocal, { zone: o.timeZone });
  const end = DateTime.fromSQL(o.endLocal, { zone: o.timeZone });
  const readings = end.getPossibleOffsets().map((d) => d.toMillis()).sort((a, b) => a - b);
  const endMs = o.endReading === 'later' ? readings.at(-1)! : readings[0]!;
  const altEndMs = readings.length > 1 ? (o.endReading === 'later' ? readings[0]! : readings.at(-1)!) : null;
  const atMs = findChange(start.toMillis(), Math.max(endMs, altEndMs ?? 0), o.timeZone);
  return {
    key: o.key,
    label: o.label,
    timeZone: o.timeZone,
    startLocal: o.startLocal,
    endLocal: o.endLocal,
    startMs: start.toMillis(),
    endMs,
    change: atMs === null ? null : { atMs, before: offsetAt(start.toMillis(), o.timeZone), after: offsetAt(atMs, o.timeZone) },
    altEndMs,
    outcome: o.outcome,
  };
}
