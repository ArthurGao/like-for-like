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
let deck = '';

beforeAll(async () => {
  runs = await readRunReports();
  knowledge = (await knowledgeFiles()).map((f) => frontMatter(read(`knowledge/${f}`)).meta);
  execFileSync('npm', ['run', '--silent', 'db:reset'], { stdio: 'pipe' });
  execFileSync('npm', ['run', '--silent', 'seed'], { stdio: 'pipe' });
  execFileSync('npm', ['run', '--silent', 'site:build'], { stdio: 'pipe' });
  html = read('site/dist/details.html');
  deck = read('site/dist/index.html');
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

  it('maps role requirements to evidence computed from the run files, and marks what is not shown', () => {
    const last = ['timesheet', 'clock-events'].map((f) => ofFeature(f).at(-1)!.report);
    const total = last.reduce((n, r) => n + r.summary.recordsCompared, 0).toLocaleString('en-NZ');
    expect(html).toContain(`${total} records compared one by one across 2 features`);
    expect(html).toContain(`${runs.at(-1)!.report.isolation.length} negative isolation tests in every run`);
    const decisionRows = (id: string) => {
      try { return (read(`runs/${id}/decisions.md`).match(/^\| D\d+ /gm) ?? []).length; } catch { return 0; }
    };
    const decided = runs.reduce((k, r) => k + decisionRows(r.id), 0) + parseTriage(read('harness/triage.yaml')).length;
    expect(html).toContain(`${decided} decisions are on record.`);
    expect(html).toContain('There is no real Cognito in this demo.');
    expect(html).toContain('The data is synthetic, not live customers.');
    expect(html.match(/○ Not in this demo/g)).toHaveLength(2);
    expect(html).toContain('Claude Code sessions wrote the code');
  });

  it('tells the story in order and marks every human stop', () => {
    const steps = [...html.matchAll(/<li class="who-(human|agent|harness)">/g)].map((m) => m[1]);
    // brief, then per feature: agent, a harness step per run, and a human step after each run that needed decisions
    expect(steps).toEqual(['human', 'agent', 'harness', 'human', 'harness', 'agent', 'harness', 'human', 'harness']);
    expect(html).toContain(`${steps.filter((x) => x === 'human').length} of ${steps.length}`);
    const r3 = runs.find((r) => r.id === '003')!.report;
    expect(html).toContain(`Run 003: ${r3.summary.recordsCompared} records compared, ${new Set(r3.mismatches.map((m: { legacyShiftId: number }) => m.legacyShiftId)).size} differ. ${r3.summary.failed} of 5 checks fail, so the agent stops.`);
    expect(html).toContain('2 groups of differences (9 legacy-bug-keep, 1 acceptable) and 2 open questions from the agent');
    expect(html).toContain('proposed by a builder session (Claude) and reviewed and approved by the owner, Arthur Gao');
    for (const t of parseTriage(read('harness/triage.yaml'))) expect(t.decidedBy).toMatch(/^Arthur Gao \(proposed by the builder session/);
  });

  it('frames the page as a work sample and states the findings from the run files', () => {
    const seeded = json('runs/seeded/report.json');
    expect(html).toContain('A work sample for a migration tech lead role.');
    expect(html).toContain('3 things this run found past the happy path');
    expect(html).toContain(`Only the per-employee weekly totals (${seeded.weeklyTotals.differing} of ${seeded.weeklyTotals.groups} weeks)`);
    const metas = ['002', '004'].map((id) => json(`runs/${id}/meta.json`).guardAudit);
    expect(html).toContain(`${metas.reduce((n, m) => n + m.blockedCalls.length, 0)} calls were stopped by the guard`);
  });

  it('names no real company or person', () => {
    expect(html).not.toMatch(/ostitech/i);
    expect(deck).not.toMatch(/ostitech/i);
    expect(read('README.md')).not.toMatch(/ostitech/i);
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

describe('deck (index.html)', () => {
  const slides = () => [...deck.matchAll(/<section class="slide ([a-z]*)"/g)].map((m) => m[1]);

  it('runs the story in order with the human slides marked', () => {
    // title, job, method, system, feature 1 run, human, feature 2 run, human, feature 2 final run, finding, guardrails, role
    expect(slides()).toEqual(['', '', '', 'wide', '', 'human', '', 'human', '', '', '', '']);
    expect(deck.match(/<span class="tag">Human in the loop<\/span>/g)).toHaveLength(2);
    const seconds = [...deck.matchAll(/data-dur="(\d+)"/g)].reduce((n, m) => n + Number(m[1]), 0) / 1000;
    expect(deck).toContain(`in ${slides().length} slides and about ${Math.round(seconds / 10) * 10} seconds`);
  });

  it('draws one square per compared record and marks exactly the differing ones', () => {
    const grids = [...deck.matchAll(/<div class="gridbox"[^>]*>([\s\S]*?)<\/div><\/div><\/div>/g)].map((m) => m[1]!);
    const shape = grids.map((g) => [(g.match(/<i /g) ?? []).length, (g.match(/class="bad"/g) ?? []).length, (g.match(/class="keep"/g) ?? []).length]);
    const r = (id: string) => runs.find((x) => x.id === id)!.report;
    const differing = (id: string) => new Set(r(id).mismatches.map((m: { legacyShiftId: number }) => m.legacyShiftId)).size;
    expect(shape).toEqual([
      [r('001').summary.recordsCompared, differing('001'), 0],
      [r('003').summary.recordsCompared, differing('003'), 0],
      [r('004').summary.recordsCompared, 0, differing('004')],
    ]);
  });

  it('states each run and the decisions from the files, and links to the evidence', () => {
    const r3 = runs.find((x) => x.id === '003')!.report;
    expect(deck).toContain(`The harness caught ${new Set(r3.mismatches.map((m: { legacyShiftId: number }) => m.legacyShiftId)).size} records, and the agent stopped`);
    for (const t of parseTriage(read('harness/triage.yaml'))) {
      const k = t.match.legacyShiftIds.length;
      expect(deck).toContain(`${k} record${k === 1 ? '' : 's'}: <code>${esc(t.decision)}</code>`);
      expect(deck).toContain(esc(t.reason));
    }
    expect(deck).toContain('href="details.html"');
    expect(deck).toContain('reviewed and approved by the owner, Arthur Gao');
    expect(html).toContain('<a href="./">The two-minute deck</a>');
  });

  it('draws the system with the human nodes, the fence and the denied arrow, in both pages', () => {
    for (const page of [deck, html]) {
      expect(page.match(/<g class="n human /g)).toHaveLength(2);
      expect(page).toContain('<g class="e blocked s2">');
      expect(page).toContain('class="fence-r"');
      expect(page.match(/data-step="\d"/g)).toHaveLength(7);
      const total = ['timesheet', 'clock-events'].reduce((n, f) => n + ofFeature(f).at(-1)!.report.summary.recordsCompared, 0);
      expect(page).toContain(`compares them record by record: ${total.toLocaleString('en-NZ')} records so far.`);
      expect(page).not.toContain('ARCH_CSS');
      expect(page).not.toContain('ARCH_JS');
    }
  });

  it('is self-contained and small', () => {
    expect(Buffer.byteLength(deck)).toBeLessThan(150 * 1024);
    expect(deck.match(/<script/g)).toHaveLength(1);
  });
});
