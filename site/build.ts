// npm run site:build: render site/dist/index.html from the files real runs wrote.
// Nothing on the page is typed in by hand: figures come from runs/**, knowledge/**, the feature
// folder, the agent rules and a sample of legacy rows read from the database.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { matchGuard } from '../.claude/hooks/guard-match.mjs';
import { knowledgeFiles, readRunReports, repoRoot } from '../harness/lib/runs.ts';
import { runMain } from '../platform/cli.ts';
import { DateTime } from 'luxon';
import { getFeature } from '../harness/features/index.ts';
import { adminPool, migratorPool } from '../platform/db.ts';
import { findTriage, parseTriage } from '../harness/lib/triage.ts';
import { esc, frontMatter, md } from './md.ts';
import { checkIntegers, checkMeta, checkReport } from './validate.ts';
import { legacyGrid, night, type Grid, type Night, type RunViz } from './viz.ts';

const REPO_URL = 'https://github.com/ArthurGao/like-for-like';
const OWNER_URL = 'https://github.com/ArthurGao';
const at = (p: string) => new URL(p, repoRoot);
const text = (p: string) => readFile(at(p), 'utf8');
const json = async (p: string) => JSON.parse(await text(p));
/** The file's text, or null when it does not exist. */
const maybe = (p: string) => text(p).catch(() => null);
/** How many distinct legacy records a list of mismatches touches. */
const distinctRecords = (mismatches: { legacyShiftId: number }[]) => new Set(mismatches.map((m) => m.legacyShiftId)).size;

type Check = { name: string; ok: boolean; detail?: string };
type Total = { tenant: string; legacyHours: string; newHours: string; legacyGross: string; newGross: string; ok: boolean };

const pill = (ok: boolean) => (ok ? '<span class="pill pass">✓ Pass</span>' : '<span class="pill fail">✕ Fail</span>');
const seededPill = '<span class="pill seeded">◆ Seeded</span>';
const num = (n: number) => n.toLocaleString('en-NZ');

function checksTable(checks: Check[]) {
  return `<ul class="checks">${checks.map((c) => `<li>${pill(c.ok)}<span>${esc(c.name)}</span></li>`).join('')}</ul>`;
}

function totalsTable(totals: Total[]) {
  return `<div class="scroll"><table class="num"><thead><tr><th>Tenant</th><th>Legacy hours</th><th>New hours</th><th>Legacy gross</th><th>New gross</th><th></th></tr></thead><tbody>${
    totals.map((t) => `<tr><td>${esc(t.tenant)}</td><td>${esc(t.legacyHours)}</td><td>${esc(t.newHours)}</td><td>${esc(t.legacyGross)}</td><td>${esc(t.newGross)}</td><td>${pill(t.ok)}</td></tr>`).join('')
  }</tbody></table></div>`;
}

type MismatchOpts = { id: string; label: string; newLabel: string; triage?: (m: any) => string };

function mismatchTable(mismatches: any[], tenants: string[], o: MismatchOpts) {
  const counts = tenants.map((t) => [t, distinctRecords(mismatches.filter((m) => m.tenant === t))] as const);
  const filter = `<div class="filter" role="group" aria-label="Filter by tenant"><button type="button" data-tenant="" aria-pressed="true">All</button>${
    counts.map(([t, n]) => `<button type="button" data-tenant="${esc(t)}" aria-pressed="false">${esc(t)} <b>${n}</b></button>`).join('')}</div>`;
  const rows = mismatches.map((m, i) => {
    const inp = m.inputs ?? {};
    return `<tr class="mm" data-tenant="${esc(m.tenant)}"><td>${esc(m.legacyShiftId)}</td><td>${esc(m.tenant)}</td><td>${esc(m.employee)}</td><td class="nw">${esc(m.startLocal)}</td><td class="nw">${esc(m.endLocal)}</td><td><code>${esc(m.field)}</code></td><td>${esc(m.legacy)}</td><td class="hot">${esc(m.new)}</td>${o.triage ? `<td>${o.triage(m)}</td>` : ''}<td><button type="button" class="more" aria-expanded="true" aria-controls="${o.id}${i}">Inputs</button></td></tr>
<tr class="inputs" id="${o.id}${i}" data-tenant="${esc(m.tenant)}"><td colspan="${o.triage ? 10 : 9}">Time zone <b>${esc(inp.timeZone)}</b> · break ${inp.breakMin == null ? '<b>not recorded</b>' : `<b>${esc(inp.breakMin)} min</b>`} · rate <b>${esc(inp.rate)}</b></td></tr>`;
  }).join('');
  return `<div class="mm-block">${filter}<div class="scroll"><table class="num mmt"><thead><tr><th>${o.label}</th><th>Tenant</th><th>Employee</th><th>Start (local)</th><th>End (local)</th><th>Field</th><th>Legacy</th><th>${o.newLabel}</th>${o.triage ? '<th>Decision</th>' : ''}<th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

/** The bullets under a "## <heading>" section of a Markdown file. */
function bulletsUnder(src: string, heading: string): string[] {
  const part = src.split(new RegExp(`^## ${heading}\\s*$`, 'm'))[1]?.split(/^## /m)[0] ?? '';
  return part.split('\n').reduce<string[]>((acc, l) => {
    if (/^- /.test(l)) acc.push(l.slice(2));
    else if (/^\s+\S/.test(l) && acc.length) acc[acc.length - 1] += ` ${l.trim()}`;
    return acc;
  }, []);
}

async function legacySample() {
  const db = migratorPool();
  const q = async (sql: string) => (await db.query(sql)).rows;
  const tenants = await q(`SELECT "ID" AS id, "NAME" AS name, "TIMEZONE" AS tz FROM legacy."OSUSR_A1B_TENANT" ORDER BY "ID"`);
  const employees = await q(`SELECT * FROM (SELECT e.*, row_number() OVER (PARTITION BY "TENANTID" ORDER BY "ID") n FROM legacy."OSUSR_A1B_EMPLOYEE" e) x WHERE n <= 2 ORDER BY "TENANTID", "ID"`);
  const shifts = await q(`SELECT * FROM (SELECT s.*, row_number() OVER (PARTITION BY "TENANTID" ORDER BY "ID") n FROM legacy."OSUSR_A1B_SHIFT" s) x WHERE n <= 2 ORDER BY "TENANTID", "ID"`);
  const counts = (await q(`SELECT (SELECT count(*) FROM legacy."OSUSR_A1B_TENANT")::int AS tenants, (SELECT count(*) FROM legacy."OSUSR_A1B_EMPLOYEE")::int AS employees, (SELECT count(*) FROM legacy."OSUSR_A1B_SHIFT")::int AS shifts`))[0];
  return { tenants, employees, shifts, counts };
}

const rowsTable = (rows: Record<string, unknown>[]) => {
  const cols = Object.keys(rows[0] ?? {}).filter((c) => c !== 'n');
  return `<div class="scroll"><table class="code"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${cols.map((c) => `<td>${r[c] === null ? '<i>NULL</i>' : esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
};

runMain(async () => {
  const runs = await Promise.all((await readRunReports()).map(async ({ id, report }) => {
    const metaText = await maybe(`runs/${id}/meta.json`);
    return {
      id,
      report: checkReport(id, report),
      meta: metaText ? checkMeta(id, JSON.parse(metaText)) : null,
      notes: await maybe(`runs/${id}/run-notes.md`),
      decisions: await maybe(`runs/${id}/decisions.md`),
    };
  }));
  if (runs.length === 0) throw new Error('no runs in runs/');
  type Run = (typeof runs)[number];
  // The first feature migrated carries the main story; each later one gets its own panel.
  const [primary, ...later] = [...new Set(runs.map((r) => r.report.feature as string))] as [string, ...string[]];
  const of = (feature: string) => runs.filter((r) => r.report.feature === feature);
  const metaOf = (rs: Run[]) => [...rs].reverse().find((r) => r.meta)?.meta;
  const ts = of(primary);
  const first = ts[0]!;
  const last = ts.at(-1)!;
  const meta = metaOf(ts);
  const triageEntries = parseTriage(await text('harness/triage.yaml'));
  const seeded = checkIntegers('seeded', await json('runs/seeded/report.json'),
    ['summary.recordsCompared', 'summary.mismatches', 'weeklyTotals.groups', 'weeklyTotals.differing']);
  const brief = await text(`features/${primary}/brief.md`);
  const mapping = await text(`features/${primary}/mapping.md`);
  const skill = await text('.claude/skills/migrate-feature/SKILL.md');
  const rules = bulletsUnder(await text('CLAUDE.md'), 'Your job');
  const knowledge = await Promise.all((await knowledgeFiles()).map(async (f) => ({ file: f, ...frontMatter(await text(`knowledge/${f}`)) })));
  const featureFiles = (await readdir(at(`features/${primary}/`))).filter((f) => f !== 'brief.md' && !f.startsWith('.') && f !== 'node_modules').sort();
  const decisionsRun = ts.find((r) => r.decisions);
  const fromFeature = (name: string) => knowledge.filter((k) => (k.meta.source ?? '').includes(`feature ${name}`));
  const tsKnowledge = fromFeature(primary);
  const applied = (notes: string | null) => knowledge.filter((k) => notes?.includes(k.file.replace(/\.md$/, '')));
  const decisionCount = decisionsRun ? (decisionsRun.decisions!.match(/^\| D\d+ /gm) ?? []).length : 0;
  const sample = await legacySample();
  const steps = [...skill.matchAll(/^## (\d+)\. (.+)\n\n([\s\S]*?)(?=\n## |\s*$)/gm)].map((m) => ({ n: m[1]!, name: m[2]!, body: m[3]!.trim() }));
  const blocked: { tool: string; input: string; reason: string }[] = meta?.guardAudit?.blockedCalls ?? [];
  // The audit kept each stopped call's main argument; put it back under the key its tool uses.
  const asInput = (b: { tool: string; input: string }) =>
    b.tool === 'Bash' ? { command: b.input } : b.input ? { file_path: b.input, path: b.input } : {};
  const blockedNow = blocked.map((b) => ({ ...b, stillBlocked: !!matchGuard(b.tool, asInput(b), repoRoot.pathname) }));
  const r1 = first.report;
  const rl = last.report;
  const tenantNames: string[] = seeded.totals.map((t: Total) => t.tenant);
  const seededShifts = distinctRecords(seeded.mismatches);

  // --- Moving pictures: every record the harness compares, and the clock-change nights.
  const grids: Record<string, Grid> = {};
  for (const f of [primary, ...later]) {
    const spec = getFeature(f)!;
    grids[f] = await legacyGrid(adminPool(), spec.legacyFn, spec.key.field);
  }
  const decisionFor = (m: any) => findTriage(triageEntries, m.legacyShiftId, m.field)?.decision ?? '';
  const vizRun = (key: string, label: string, feature: string, report: any, caption: string): RunViz => ({
    key, label, feature, compared: report.summary.recordsCompared,
    // The decision a record had when this run happened (its own report), not one made later.
    mismatches: Object.fromEntries(report.mismatches.map((m: any) => [m.legacyShiftId, m.triage?.decision ?? ''])),
    caption,
  });
  const decisionSummary = (mismatches: any[], decide: (m: any) => string) => {
    const by = new Map<string, Set<number>>();
    for (const m of mismatches) {
      const d = decide(m);
      if (d) by.set(d, (by.get(d) ?? new Set()).add(m.legacyShiftId));
    }
    return [...by].map(([d, ids]) => `${ids.size} ${d}`).join(', ');
  };
  const runCaption = (r: Run) => {
    const k = distinctRecords(r.report.mismatches);
    if (k === 0) return `All ${num(r.report.summary.recordsCompared)} records match the legacy screen.`;
    const atRun = decisionSummary(r.report.mismatches, (m) => m.triage?.decision ?? '');
    const later = decisionSummary(r.report.mismatches.filter((m: any) => !m.triage), decisionFor);
    return `${k} of ${num(r.report.summary.recordsCompared)} records differ. ${r.report.summary.unexplained === 0
      ? `Every difference is explained (${atRun}).`
      : `${r.report.summary.unexplained} differences were unexplained when it ran${later ? `; decided afterwards: ${later}` : ''}.`}`;
  };
  const vizRuns: RunViz[] = [
    ...ts.map((r) => vizRun(r.id, `Run ${r.id} · ${primary}`, primary, r.report, runCaption(r))),
    vizRun('seeded', 'Seeded fault', primary, seeded,
      `A deliberately wrong calculation: ${seededShifts} of ${num(seeded.summary.recordsCompared)} records differ, all on clock-change nights.`),
    ...later.flatMap((f) => of(f).map((r) => vizRun(r.id, `Run ${r.id} · ${f}`, f, r.report, runCaption(r)))),
  ];
  const nights: Night[] = [];
  const seen = new Set<string>();
  for (const m of seeded.mismatches.filter((x: any) => x.field === 'paid_hours')) {
    const date = String(m.startLocal).slice(0, 10);
    if (seen.has(date) || !m.inputs) continue;
    seen.add(date);
    nights.push(night({
      key: `n${nights.length}`, label: `${date}, ${m.tenant}`, timeZone: m.inputs.timeZone,
      startLocal: m.startLocal, endLocal: m.endLocal,
      outcome: `Legacy pays ${m.legacy} h: real time less the 30-minute break. The seeded wrong calculation counted the wall clock and paid ${m.new} h.`,
    }));
  }
  for (const f of later) {
    const fr = of(f)[0];
    for (const m of (fr?.report.mismatches ?? []).filter((x: any) => x.field === 'paid_hours' && x.inputs)) {
      if (DateTime.fromSQL(m.endLocal, { zone: m.inputs.timeZone }).getPossibleOffsets().length < 2) continue;
      nights.push(night({
        key: `n${nights.length}`, label: `${String(m.startLocal).slice(0, 10)}, ${m.tenant} (${f})`, timeZone: m.inputs.timeZone,
        startLocal: m.startLocal, endLocal: m.endLocal, endReading: 'later',
        outcome: `The clock shows ${String(m.endLocal).slice(11, 16)} twice. Legacy reads the later one and pays ${m.legacy} h; the agent's rule from the first feature reads the earlier one and paid ${m.new} h. Decision: ${decisionFor(m) || 'none yet'}.`,
      }));
    }
  }

  const cards = (entries: typeof knowledge) => `<div class="cards">${entries.map((k) => {
    const part = (label: string) => (new RegExp(`^${label}:\\s*([\\s\\S]*?)(?=^\\w+:|$(?![\\s\\S]))`, 'm').exec(k.body)?.[1] ?? '').trim();
    return `<article class="card"><h3>${esc(k.meta.title ?? k.file)}</h3><p class="src">${esc(k.meta.scope ?? '')} · ${esc(k.meta.source ?? '')}</p><dl><dt>Rule</dt><dd>${md(part('Rule'), 3)}</dd></dl><details><summary>Why, and how it is checked</summary><dl><dt>Why</dt><dd>${md(part('Why'), 3)}</dd><dt>Check</dt><dd>${md(part('Check'), 3)}</dd></dl></details></article>`;
  }).join('')}</div>`;

  const station = (cls: string, name: string, fig: string, cap: string) =>
    `<li class="st ${cls}"><span class="st-name">${name}</span><span class="st-fig">${fig}</span><span class="st-cap">${cap}</span></li>`;

  function laterFeature(name: string, index: number) {
    const fr = of(name);
    const [runFirst, runLast] = [fr[0]!, fr.at(-1)!];
    const [c1, cl] = [runFirst.report, runLast.report];
    const fMeta = metaOf(fr);
    const ownKnowledge = fromFeature(name);
    const row = (label: string, a: unknown, b: unknown) => `<tr><td>${label}</td><td>${esc(a)}</td><td>${esc(b)}</td></tr>`;
    // Entries that existed when the session started (this feature's own new entries are not 'applied').
    const used = applied(runLast.notes).filter((k) => !ownKnowledge.includes(k));
    const decisionOf = (m: any) => {
      const t = findTriage(triageEntries, m.legacyShiftId, m.field);
      return t ? `<code>${esc(t.decision)}</code>` : '<i>none</i>';
    };
    const triageRows = triageEntries.filter((t) => c1.mismatches.some((m: any) => t.match.legacyShiftIds.includes(m.legacyShiftId)));
    return `<section class="band alt" id="${index === 0 ? 'second' : `feature-${esc(name)}`}"><div class="band-in">
  <h2>Feature ${index + 2}: ${esc(name)}, started from ${c1.knowledgeEntriesAtStart} knowledge entries</h2>
  <p>A fresh session migrated it from its brief and the knowledge base. Its first run, ${esc(runFirst.id)}, found ${c1.summary.mismatches} differences on ${distinctRecords(c1.mismatches)} pairs. ${triageRows.length ? 'Each group got a decision in <code>harness/triage.yaml</code>; after the agent applied them, ' : ''}run ${esc(runLast.id)} passed ${cl.summary.passed} of ${cl.summary.checks} checks with ${cl.summary.unexplained} unexplained differences.</p>
  <div class="two">
    <div>
      <h3>The two migrations side by side</h3>
      <div class="scroll"><table class="num"><thead><tr><th></th><th>${esc(primary)}</th><th>${esc(name)}</th></tr></thead><tbody>
        ${row('Knowledge entries at start', r1.knowledgeEntriesAtStart, c1.knowledgeEntriesAtStart)}
        ${row('Differing records in the first run', distinctRecords(r1.mismatches), distinctRecords(c1.mismatches))}
        ${row('Harness runs', meta?.harnessRuns ?? ts.length, fMeta?.harnessRuns ?? fr.length)}
        ${row('Human stops', meta?.session?.humanStops ?? '?', fMeta?.session?.humanStops ?? '?')}
        ${row('Session wall-clock, minutes', meta?.session?.durationMinutes ?? '?', fMeta?.session?.durationMinutes ?? '?')}
        ${row('Knowledge entries at end', meta?.knowledgeEntriesAtEnd ?? '?', fMeta?.knowledgeEntriesAtEnd ?? '?')}
      </tbody></table></div>
      <h3>Knowledge the agent says it applied</h3>
      <ul class="rules">${used.map((k) => `<li>${esc(k.meta.title ?? k.file)}</li>`).join('') || '<li>None named in the run notes.</li>'}</ul>
    </div>
    <div>
      <h3>The human decisions on run ${esc(runFirst.id)}</h3>
      <div class="scroll"><table><thead><tr><th>Group</th><th>Decision</th><th>Reason</th><th>Records</th></tr></thead><tbody>${
        triageRows.map((t) => `<tr><td><code>${esc(t.id)}</code></td><td><code>${esc(t.decision)}</code></td><td>${esc(t.reason)}<br><i>${esc(t.decidedBy)}</i></td><td>${t.match.legacyShiftIds.length}</td></tr>`).join('')}</tbody></table></div>
      <h3>Final run ${esc(runLast.id)}</h3>${checksTable(cl.checks)}
    </div>
  </div>
  <h3>Run ${esc(runFirst.id)}: every difference, with the decision it got</h3>
  ${mismatchTable(c1.mismatches, tenantNames, { id: `f${index}-`, label: 'Record', newLabel: 'New', triage: decisionOf })}
  ${ownKnowledge.length ? `<h3>Lessons written after ${esc(name)}</h3>${cards(ownKnowledge)}` : ''}
</div></section>`;
  }

  const content = `
<header class="band hero">
  <div class="hero-top">
    <div>
      <h1>Like for like</h1>
      <p class="lede">One feature, migrated by an agent and proven by a harness.</p>
      <p class="src-line">Legacy source: a simulated <b>OutSystems</b> application, moved to multi-tenant PostgreSQL.</p>
      <ul class="labels"><li>Synthetic data</li><li>Real run output</li><li>Tenant token is a local stand-in for Cognito</li></ul>
    </div>
    <p class="repo"><a href="${REPO_URL}">Repository on GitHub</a></p>
  </div>
  <ol class="loop" aria-label="The loop">
    ${station('s-legacy', 'Legacy', num(sample.counts.shifts), `shifts in ${sample.counts.tenants} tenants; the original calculation is a black box`)}
    ${station('s-agent', 'Agent', `${meta?.session?.durationMinutes ?? '?'} min`, `session wall-clock, including the wait for decisions; a fresh Claude Code session wrote ${featureFiles.length} files in ${num(meta?.guardAudit?.toolCalls ?? 0)} tool calls, legacy logic denied`)}
    ${station('s-harness', 'Harness', num(r1.summary.recordsCompared), `records compared shift by shift in run ${esc(first.id)}: ${r1.summary.mismatches} mismatches`)}
    ${station('s-human', 'Decision', String(decisionCount), `open questions decided and written down`)}
    ${station('s-know', 'Knowledge', String(knowledge.length), `entries the next feature reads first`)}
  </ol>
  <p class="loop-back">↺ The next feature starts from the knowledge base.</p>
</header>

<nav class="stepper" aria-label="Steps"><div class="band-in">
  <a href="#watch">Watch</a>${nights.length ? '<a href="#night">The hard night</a>' : ''}<a href="#legacy">1 Original</a><a href="#agent">2 Agent</a><a href="#run-1">3 Run ${esc(first.id)}</a><a href="#decision">4 Decision</a><a href="#run-2">5 Run ${esc(last.id)}</a>${later.map((name, i) => `<a href="#${i === 0 ? 'second' : `feature-${esc(name)}`}">${6 + i} ${esc(name)}</a>`).join('')}<a href="#seeded">Seeded fault</a>
</div></nav>

<main>
<section class="band" id="watch"><div class="band-in">
  <h2>Watch the harness compare, record by record</h2>
  <p class="lede-s">Each square is one record the harness compared with the legacy screen, grouped by tenant. Pick a run.</p>
  <div class="runpick" role="group" aria-label="Run">${vizRuns.map((r, i) => `<button type="button" data-run="${esc(r.key)}" aria-pressed="${i === 0}">${esc(r.label)}</button>`).join('')}</div>
  <div class="watch">
    <div class="fig grid-fig" id="grid-fig" role="img" aria-label="Records compared in the selected run"><noscript><p>${vizRuns.map((r) => `${esc(r.label)}: ${esc(r.caption)}`).join('<br>')}</p></noscript></div>
    <div class="tally">
      <p><b id="t-compared">0</b><span>records compared</span></p>
      <p><b id="t-diff" class="hot">0</b><span>differ from legacy</span></p>
      <p class="legend"><span><i class="sw ok"></i> matches</span><span><i class="sw bad"></i> differs, unexplained</span><span><i class="sw keep"></i> differs, decided</span></p>
      <p id="t-caption" class="cap"></p>
      <button type="button" id="replay" class="ghost">Replay</button>
    </div>
  </div>
</div></section>

${nights.length ? `<section class="band alt" id="night"><div class="band-in">
  <h2>Why one night is hard: the wall clock and real time part</h2>
  <p class="lede-s">The legacy tables store local wall-clock time with no zone. On these nights the clocks change, so the hours on the clock are not the hours worked.</p>
  <div class="runpick" role="group" aria-label="Night">${nights.map((n, i) => `<button type="button" data-night="${esc(n.key)}" aria-pressed="${i === 0}">${esc(n.label)}</button>`).join('')}</div>
  <div class="nightbox">
    <div class="clocks">
      <p><span>Wall clock</span><b id="n-wall">--:--</b></p>
      <p><span>Hours on the clock</span><b id="n-wallh">0:00</b></p>
      <p><span>Real time worked</span><b id="n-real" class="hot">0:00</b></p>
    </div>
    <div class="fig track-fig" id="track-fig" role="img" aria-label="The shift on a real-time axis with the wall clock above it"></div>
    <div class="nightctl"><button type="button" id="n-play" class="ghost">Play</button><input type="range" id="n-slider" min="0" max="1000" value="0" aria-label="Time through the shift"></div>
    <p id="n-outcome" class="cap"></p>
    <noscript><ul>${nights.map((n) => `<li>${esc(n.label)}: ${esc(n.startLocal)} to ${esc(n.endLocal)} (${esc(n.timeZone)}). ${esc(n.outcome)}</li>`).join('')}</ul></noscript>
  </div>
</div></section>` : ''}

<section class="band" id="legacy"><div class="band-in two">
  <div>
    <h2>The original: OutSystems-style tables and a calculation nobody may read</h2>
    <div class="callout"><p><b>Simulated OutSystems data source.</b> The legacy side is modelled on the physical tables an OutSystems application generates: <code>OSUSR_&lt;module&gt;_&lt;entity&gt;</code> table names, upper-case column names, <code>DateTime</code> values stored as local wall-clock time with no zone, soft delete through an <code>IS_ACTIVE</code> flag, and statuses kept as integer codes. The screen logic is a PostgreSQL function standing in for the OutSystems server action. The rows are synthetic, generated for this demo; nothing was exported from a real OutSystems environment, and this project is not affiliated with OutSystems.</p></div>
    <p>${num(sample.counts.tenants)} tenants, ${num(sample.counts.employees)} employees and ${num(sample.counts.shifts)} shifts, generated from a fixed seed. Start and end are stored as local wall-clock time with no zone; each tenant has a time zone. The legacy function <code>legacy.fn_timesheet()</code> returns paid hours and gross pay per payable shift. The migration session was denied read access to its source.</p>
    <h3>Tenants</h3>${rowsTable(sample.tenants)}
    <h3>Employees (first two per tenant)</h3>${rowsTable(sample.employees)}
    <h3>Shifts (first two per tenant)</h3>${rowsTable(sample.shifts)}
  </div>
  <details class="doc fold"><summary class="doc-h">The brief, as the agent received it</summary><div class="doc-body">${md(brief, 2)}</div></details>
</div></section>

<section class="band alt" id="agent"><div class="band-in">
  <h2>The agent's method: a skill, rules it cannot change, and a guard</h2>
  <div class="two">
    <div>
      <h3>The migrate-feature skill</h3>
      <ol class="steps">${steps.map((s) => `<li><b>${esc(s.name)}</b><span>${md(s.body.split('\n\n')[0]!, 3)}</span></li>`).join('')}</ol>
    </div>
    <div>
      <h3>Rules in CLAUDE.md</h3>
      <ul class="rules">${rules.map((r) => `<li>${md(r, 3).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')}</ul>
      <h3>The guard during the session</h3>
      <p>${num(meta?.guardAudit?.transcripts ?? 0)} transcripts audited, ${num(meta?.guardAudit?.toolCalls ?? 0)} tool calls, <b>${(meta?.guardAudit?.findings ?? []).length} leaks</b>. ${blocked.length} calls were stopped. ${blockedNow.filter((b) => !b.stillBlocked).length} of them would pass today's guard rules: those stops were false positives (mostly <code>2&gt;&amp;1</code> read as a write), fixed after the run.</p>
      <div class="scroll"><table class="code"><thead><tr><th>Tool</th><th>Call</th><th>Guard stops it today</th></tr></thead><tbody>${
        blockedNow.map((b) => `<tr><td>${esc(b.tool)}</td><td>${esc(b.input.slice(0, 90))}${b.input.length > 90 ? '…' : ''}</td><td>${b.stillBlocked ? 'yes' : 'no'}</td></tr>`).join('')}</tbody></table></div>
    </div>
  </div>
  <details class="doc wide fold"><summary class="doc-h">What the agent produced: the mapping (assumptions and open questions)</summary><div class="doc-body">${md(mapping, 2)}</div></details>
</div></section>

<section class="band" id="run-1"><div class="band-in">
  <h2>Run ${esc(first.id)}: ${r1.summary.passed} of ${r1.summary.checks} checks passed, ${r1.summary.mismatches} mismatches in ${num(r1.summary.recordsCompared)} records</h2>
  <p>${r1.summary.mismatches === 0 ? `The agent got the feature right on the first run. Nothing was staged: the harness compared every payable shift with the legacy function and found no difference, in the Auckland tenant (which changes its clocks twice in the seeded windows) as well as in the Brisbane control. The <a href="#seeded">seeded-fault panel</a> shows the same harness catching a deliberately wrong calculation.` : `The harness found ${r1.summary.mismatches} differences; each is listed with both values and its inputs.`}</p>
  <div class="two">
    <div><h3>Checks</h3>${checksTable(r1.checks)}</div>
    <div><h3>Totals per tenant, legacy vs new</h3>${totalsTable(r1.totals)}</div>
  </div>
</div></section>

<section class="band alt" id="decision"><div class="band-in">
  <h2>The decision: ${decisionCount} open questions settled, ${tsKnowledge.length} lessons written down</h2>
  ${decisionsRun ? `<div class="doc wide"><div class="doc-body">${md(decisionsRun.decisions!, 2)}</div></div>` : '<p>No decisions recorded.</p>'}
  ${cards(tsKnowledge)}
</div></section>

<section class="band" id="run-2"><div class="band-in">
  <h2>Run ${esc(last.id)}: ${rl.summary.passed} of ${rl.summary.checks} checks passed after the decisions</h2>
  <ul class="figs">
    <li><b>${meta?.harnessRuns ?? ts.length}</b><span>harness runs</span></li>
    <li><b>${meta?.session?.humanStops ?? '?'}</b><span>human stops</span></li>
    <li><b>${meta?.knowledgeEntriesAtStart ?? 0} → ${meta?.knowledgeEntriesAtEnd ?? tsKnowledge.length}</b><span>knowledge entries</span></li>
    <li><b>${num(rl.summary.recordsCompared)}</b><span>records, ${rl.summary.mismatches} mismatches</span></li>
  </ul>
  <div class="two">
    <div><h3>Checks</h3>${checksTable(rl.checks)}<h3>Totals per tenant</h3>${totalsTable(rl.totals)}</div>
    <div>
      <h3>Isolation, tested through the runtime role</h3>${checksTable(rl.isolation)}
      <h3>Idempotency: second migration, same checksums</h3>
      <div class="scroll"><table class="code"><thead><tr><th>Table</th><th>Rows</th><th>md5 before</th><th>after</th></tr></thead><tbody>${
        (rl.idempotency.before ?? []).map((b: any, i: number) => `<tr><td>${esc(b.table)}</td><td>${esc(b.rows)}</td><td>${esc(String(b.md5).slice(0, 10))}</td><td>${esc(String(rl.idempotency.after[i]?.md5 ?? '').slice(0, 10))}</td></tr>`).join('')}</tbody></table></div>
    </div>
  </div>
  ${last.notes ? `<details><summary>Run notes for run ${esc(last.id)}, as the agent wrote them</summary><div class="doc-body">${md(last.notes, 2)}</div></details>` : ''}
</div></section>

${later.map(laterFeature).join('\n')}

<section class="band fault" id="seeded"><div class="band-in">
  <p>${seededPill}</p>
  <h2>${esc(seeded.label)}</h2>
  <p>To prove the harness itself works, it was run against a deliberately wrong calculation: <b>${esc(seeded.fault)}</b> Every other rule is right. It reported ${seeded.summary.mismatches} differences on ${seededShifts} shifts${seeded.assertions.every((a: Check) => a.ok) ? ', all on the nights the Auckland clocks change, and none in the Brisbane control' : ''}.${
    seeded.summary.mismatches > 0 && seeded.totals.every((t: Total) => t.ok)
      ? ` Every tenant total still matched: the same staff gained an hour on one clock-change night and lost it on the other, so a check on tenant totals alone would have passed. The per-employee weekly totals (${seeded.weeklyTotals.differing} of ${seeded.weeklyTotals.groups} weeks differ) and the record-by-record check caught it.`
      : ''}</p>
  <div class="two narrow-right">
    <div>${mismatchTable(seeded.mismatches, tenantNames, { id: 'sf', label: 'Shift', newLabel: 'Wrong calc' })}</div>
    <div><h3>Assertions</h3>${checksTable(seeded.assertions)}<h3>Totals</h3>${totalsTable(seeded.totals)}</div>
  </div>
</div></section>
</main>

<footer class="band"><div class="band-in">
  <p><b>What this is not.</b> No hosted backend or live database behind this page, no real Cognito (tokens are signed locally), no custom agent loop (the agent is Claude Code), and two small features only. All names and numbers are synthetic; every figure above is read from a file in the repository.</p>
  <p>Repository: <a href="${REPO_URL}">${esc(REPO_URL.replace('https://', ''))}</a> · built from commit-tracked run files · contact: <a href="${OWNER_URL}">${esc(OWNER_URL.replace('https://', ''))}</a></p>
</div></footer>`;

  const data = {
    runs: runs.map((r) => ({ id: r.id, summary: r.report.summary, checks: r.report.checks })),
    seeded: seeded.summary,
    knowledge: knowledge.map((k) => k.meta.title),
    viz: { grids, runs: vizRuns, nights },
  };
  const template = await text('site/template.html');
  const html = template
    .replace('<!--CONTENT-->', content)
    .replace('<!--DATA-->', JSON.stringify(data).replace(/</g, '\\u003c'));
  await mkdir(at('site/dist/'), { recursive: true });
  await writeFile(at('site/dist/index.html'), html);
  console.log(`site: site/dist/index.html (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
});
