import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

export const DECISIONS = ['new-system-bug', 'legacy-bug-keep', 'legacy-bug-fix', 'acceptable'] as const;
export type Decision = (typeof DECISIONS)[number];

/** A difference is explained only when the new system is meant to differ. */
export const EXPLAINED: ReadonlySet<Decision> = new Set(['legacy-bug-fix', 'acceptable']);

export type TriageEntry = {
  id: string;
  match: { legacyShiftIds: number[]; field?: string };
  decision: Decision;
  reason: string;
  decidedBy: string;
  decidedAt?: string;
};

export type AppliedTriage = Pick<TriageEntry, 'id' | 'decision' | 'reason' | 'decidedBy'>;

export function parseTriage(text: string): TriageEntry[] {
  const doc = (parseYaml(text) ?? {}) as { decisions?: unknown };
  const list = doc.decisions ?? [];
  if (!Array.isArray(list)) throw new Error('triage: "decisions" must be a list');
  return list.map((raw, i) => {
    const e = raw as Partial<TriageEntry>;
    const where = `triage: decisions[${i}]`;
    if (typeof e.id !== 'string' || !e.id) throw new Error(`${where}: id is required`);
    if (!e.decision || !DECISIONS.includes(e.decision)) {
      throw new Error(`${where}: decision must be one of ${DECISIONS.join(', ')}`);
    }
    if (typeof e.reason !== 'string' || !e.reason.trim()) throw new Error(`${where}: reason is required`);
    if (typeof e.decidedBy !== 'string' || !e.decidedBy.trim()) {
      throw new Error(`${where}: decidedBy is required`);
    }
    const ids = e.match?.legacyShiftIds;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every(Number.isInteger)) {
      throw new Error(`${where}: match.legacyShiftIds must be a non-empty list of integers`);
    }
    return {
      id: e.id,
      match: { legacyShiftIds: ids, ...(e.match?.field ? { field: e.match.field } : {}) },
      decision: e.decision,
      reason: e.reason.trim(),
      decidedBy: e.decidedBy.trim(),
      ...(e.decidedAt ? { decidedAt: String(e.decidedAt) } : {}),
    };
  });
}

export async function loadTriage(path: URL): Promise<TriageEntry[]> {
  return parseTriage(await readFile(path, 'utf8'));
}

/** The first entry whose ids (and field, if given) cover the mismatch. */
export function findTriage(
  entries: readonly TriageEntry[],
  legacyShiftId: number,
  field: string,
): TriageEntry | undefined {
  return entries.find(
    (e) => e.match.legacyShiftIds.includes(legacyShiftId) && (!e.match.field || e.match.field === field),
  );
}

type Triageable = { legacyShiftId: number; tenant: string; field: string };
export type Triaged<M> = Omit<M, 'triage'> & { triage: AppliedTriage | null };

/**
 * Attach the matching human decision to each mismatch (returns new objects) and work out what
 * is still unexplained, per mismatch and per tenant, plus which entries matched nothing.
 */
export function applyTriage<M extends Triageable>(mismatches: readonly M[], entries: readonly TriageEntry[]) {
  const annotated = mismatches.map((m): Triaged<M> => {
    const t = findTriage(entries, m.legacyShiftId, m.field);
    return { ...m, triage: t ? { id: t.id, decision: t.decision, reason: t.reason, decidedBy: t.decidedBy } : null };
  });
  const unexplained = annotated.filter((m) => !m.triage || !EXPLAINED.has(m.triage.decision));
  const applied = [...new Set(annotated.flatMap((m) => (m.triage ? [m.triage.id] : [])))];
  return {
    mismatches: annotated,
    unexplained,
    unexplainedTenants: new Set(unexplained.map((m) => m.tenant)),
    applied,
    unmatched: entries.filter((e) => !applied.includes(e.id)).map((e) => e.id),
  };
}
