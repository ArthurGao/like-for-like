// Builder-only (reads runs/seeded): the built page states what the run files say.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { knowledgeFiles, readRunReports } from '../harness/lib/runs.ts';
import { parseTriage } from '../harness/lib/triage.ts';
import { esc, frontMatter } from './md.ts';

const root = new URL('../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const json = (p: string) => JSON.parse(read(p));
let runs: Awaited<ReturnType<typeof readRunReports>> = [];
let knowledge: Record<string, string>[] = [];
const ofFeature = (f: string) => runs.filter((r) => r.report.feature === f);
let html = '';

beforeAll(async () => {
  runs = await readRunReports();
  knowledge = (await knowledgeFiles()).map((f) => frontMatter(read(`knowledge/${f}`)).meta);
  execFileSync('npm', ['run', '--silent', 'db:reset'], { stdio: 'pipe' });
  execFileSync('npm', ['run', '--silent', 'seed'], { stdio: 'pipe' });
  execFileSync('npm', ['run', '--silent', 'site:build'], { stdio: 'pipe' });
  html = read('site/dist/index.html');
});

describe('site build', () => {
  it('heads the first and last timesheet runs with their report figures', () => {
    const ts = ofFeature('timesheet');
    const [first, last] = [ts[0]!, ts.at(-1)!];
    const s = first.report.summary;
    expect(html).toContain(`Run ${first.id}: ${s.passed} of ${s.checks} checks passed, ${s.mismatches} mismatches in ${s.recordsCompared} records`);
    expect(html).toContain(`Run ${last.id}: ${last.report.summary.passed} of ${last.report.summary.checks} checks passed after the decisions`);
  });

  it('states the second feature first and last run from their reports', () => {
    const ce = ofFeature('clock-events');
    const c1 = ce[0]!.report;
    const pairs = new Set(c1.mismatches.map((m: { legacyShiftId: number }) => m.legacyShiftId)).size;
    expect(html).toContain(`found ${c1.summary.mismatches} differences on ${pairs} pairs`);
    const cl = ce.at(-1)!.report.summary;
    expect(html).toContain(`passed ${cl.passed} of ${cl.checks} checks with ${cl.unexplained} unexplained differences`);
  });

  it('lists as applied only entries that existed before the second feature', () => {
    const part = html.split('Knowledge the agent says it applied')[1]!.split('</ul>')[0]!;
    const ceTitles = knowledge.filter((m) => (m.source ?? '').includes('feature clock-events')).map((m) => esc(m.title!));
    expect(ceTitles.length).toBeGreaterThan(0);
    for (const t of ceTitles) expect(part).not.toContain(t);
    expect((part.match(/<li>/g) ?? []).length).toBe(ofFeature('clock-events')[0]!.report.knowledgeEntriesAtStart);
  });

  it('shows every knowledge entry and every triage decision', () => {
    expect(knowledge.length).toBeGreaterThan(0);
    for (const m of knowledge) expect(html).toContain(esc(m.title!));
    for (const t of parseTriage(read('harness/triage.yaml'))) expect(html).toContain(`<code>${esc(t.id)}</code>`);
  });

  it('names the simulated OutSystems source and says the data is synthetic', () => {
    expect(html).toContain('Legacy source: a simulated <b>OutSystems</b> application');
    expect(html).toContain('nothing was exported from a real OutSystems environment, and this project is not affiliated with OutSystems');
  });

  it('states the seeded fault from its report and labels it', () => {
    const seeded = json('runs/seeded/report.json');
    expect(html).toContain(`It reported ${seeded.summary.mismatches} differences on`);
    expect(html).toContain('Seeded fault: we broke it on purpose');
  });

  it('animates exactly the records each report compared, and marks exactly its differences', () => {
    const viz = JSON.parse(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/.exec(html)![1]!).viz;
    const sizeOf = (feature: string) => viz.grids[feature].reduce((n: number, g: { ids: number[] }) => n + g.ids.length, 0);
    const seeded = json('runs/seeded/report.json');
    expect(viz.runs.map((r: { key: string }) => r.key)).toEqual([...ofFeature('timesheet').map((r) => r.id), 'seeded', ...ofFeature('clock-events').map((r) => r.id)]);
    for (const r of viz.runs) {
      const report = r.key === 'seeded' ? seeded : runs.find((x) => x.id === r.key)!.report;
      expect(sizeOf(r.feature)).toBe(report.summary.recordsCompared);
      expect(Object.keys(r.mismatches).map(Number).sort((a, b) => a - b))
        .toEqual([...new Set<number>(report.mismatches.map((m: { legacyShiftId: number }) => m.legacyShiftId))].sort((a, b) => a - b));
    }
  });

  it('tells each clock-change night with the values from the reports', () => {
    const viz = JSON.parse(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/.exec(html)![1]!).viz;
    const seeded = json('runs/seeded/report.json');
    const nights = viz.nights as { label: string; outcome: string; startMs: number; endMs: number }[];
    expect(nights.length).toBeGreaterThanOrEqual(2);
    for (const m of seeded.mismatches.filter((x: { field: string }) => x.field === 'paid_hours')) {
      const n = nights.find((x) => x.label.startsWith(String(m.startLocal).slice(0, 10)) && x.outcome.includes(`paid ${m.new} h`));
      expect(n?.outcome).toContain(`Legacy pays ${m.legacy} h`);
    }
    // 22:00 to 06:00 across the April change is nine real hours.
    const april = nights.find((x) => x.label.startsWith('2026-04-04') && !x.label.includes('('))!;
    expect((april.endMs - april.startMs) / 3_600_000).toBe(9);
  });

  it('is one self-contained file under 300 KB with only its own two scripts', () => {
    expect(Buffer.byteLength(html)).toBeLessThan(300 * 1024);
    expect(html.match(/<script/g)).toHaveLength(2);
    expect(html).not.toMatch(/<(img|iframe)\b[^>]*\bsrc="https?:/);
  });
});
