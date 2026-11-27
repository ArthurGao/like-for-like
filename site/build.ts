// npm run site:build: render site/dist/index.html from the files real runs wrote.
// Nothing on the page is typed in by hand: figures come from runs/**, knowledge/**, the feature
// folder, the agent rules and a sample of legacy rows read from the database.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { matchGuard } from '../.claude/hooks/guard-match.mjs';
import { repoRoot } from '../harness/lib/runs.ts';
import { runMain } from '../platform/cli.ts';
import { migratorPool } from '../platform/db.ts';
import { esc, frontMatter, md } from './md.ts';

const REPO_URL = 'https://github.com/ArthurGao/like-for-like';
const at = (p: string) => new URL(p, repoRoot);
const text = (p: string) => readFile(at(p), 'utf8');
const json = async (p: string) => JSON.parse(await text(p));
const exists = (p: string) => readFile(at(p)).then(() => true, () => false);

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

function mismatchTable(mismatches: any[], tenants: string[]) {
  const counts = tenants.map((t) => [t, new Set(mismatches.filter((m) => m.tenant === t).map((m) => m.legacyShiftId)).size] as const);
  const filter = `<div class="filter" role="group" aria-label="Filter by tenant"><button type="button" data-tenant="" aria-pressed="true">All</button>${
    counts.map(([t, n]) => `<button type="button" data-tenant="${esc(t)}" aria-pressed="false">${esc(t)} <b>${n}</b></button>`).join('')}</div>`;
  const rows = mismatches.map((m, i) => {
    const inp = m.inputs ?? {};
    return `<tr class="mm" data-tenant="${esc(m.tenant)}"><td>${esc(m.legacyShiftId)}</td><td>${esc(m.tenant)}</td><td>${esc(m.employee)}</td><td class="nw">${esc(m.startLocal)}</td><td class="nw">${esc(m.endLocal)}</td><td><code>${esc(m.field)}</code></td><td>${esc(m.legacy)}</td><td class="hot">${esc(m.new)}</td><td><button type="button" class="more" aria-expanded="true" aria-controls="in${i}">Inputs</button></td></tr>
<tr class="inputs" id="in${i}" data-tenant="${esc(m.tenant)}"><td colspan="9">Time zone <b>${esc(inp.timeZone)}</b> · break ${inp.breakMin == null ? '<b>not recorded</b>' : `<b>${esc(inp.breakMin)} min</b>`} · status <b>${esc(inp.status)}</b> · rate <b>${esc(inp.rate)}</b></td></tr>`;
  }).join('');
  return `${filter}<div class="scroll"><table class="num mmt"><thead><tr><th>Shift</th><th>Tenant</th><th>Employee</th><th>Start (local)</th><th>End (local)</th><th>Field</th><th>Legacy</th><th>Wrong calc</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
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
  const runDirs = (await readdir(at('runs/'))).filter((d) => /^\d{3}$/.test(d)).sort();
  const runs = await Promise.all(runDirs.map(async (d) => ({
    id: d,
    report: await json(`runs/${d}/report.json`),
    meta: (await exists(`runs/${d}/meta.json`)) ? await json(`runs/${d}/meta.json`) : null,
    notes: (await exists(`runs/${d}/run-notes.md`)) ? await text(`runs/${d}/run-notes.md`) : null,
    decisions: (await exists(`runs/${d}/decisions.md`)) ? await text(`runs/${d}/decisions.md`) : null,
  })));
  if (runs.length === 0) throw new Error('no runs in runs/');
  const first = runs[0]!;
  const last = runs.at(-1)!;
  const meta = [...runs].reverse().find((r) => r.meta)?.meta;
  const seeded = await json('runs/seeded/report.json');
  const brief = await text('features/timesheet/brief.md');
  const mapping = await text('features/timesheet/mapping.md');
  const skill = await text('.claude/skills/migrate-feature/SKILL.md');
  const rules = bulletsUnder(await text('CLAUDE.md'), 'Your job');
  const knowledgeFiles = (await readdir(at('knowledge/'))).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
  const knowledge = await Promise.all(knowledgeFiles.map(async (f) => ({ file: f, ...frontMatter(await text(`knowledge/${f}`)) })));
  const featureFiles = (await readdir(at('features/timesheet/'))).filter((f) => f !== 'brief.md' && !f.startsWith('.') && f !== 'node_modules').sort();
  const decisionsRun = runs.find((r) => r.decisions);
  const decisionCount = decisionsRun ? (decisionsRun.decisions!.match(/^\| D\d+ /gm) ?? []).length : 0;
  const sample = await legacySample();
  const steps = [...skill.matchAll(/^## (\d+)\. (.+)\n\n([\s\S]*?)(?=\n## |\s*$)/gm)].map((m) => ({ n: m[1]!, name: m[2]!, body: m[3]!.trim() }));
  const blocked: { tool: string; input: string; reason: string }[] = meta?.guardAudit?.blockedCalls ?? [];
  const blockedNow = blocked.map((b) => ({ ...b, stillBlocked: !!matchGuard(b.tool, b.tool === 'Bash' ? { command: b.input } : b.tool === 'Glob' ? {} : { file_path: b.input }, repoRoot.pathname) }));
  const r1 = first.report;
  const rl = last.report;
  const tenantNames: string[] = seeded.totals.map((t: Total) => t.tenant);
  const seededTenants = new Set(seeded.mismatches.map((m: any) => m.legacyShiftId)).size;

  const station = (cls: string, name: string, fig: string, cap: string) =>
    `<li class="st ${cls}"><span class="st-name">${name}</span><span class="st-fig">${fig}</span><span class="st-cap">${cap}</span></li>`;

  const content = `
<header class="band hero">
  <div class="hero-top">
    <div>
      <h1>Like for like</h1>
      <p class="lede">One feature, migrated by an agent and proven by a harness.</p>
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
  <a href="#legacy">1 Original</a><a href="#agent">2 Agent</a><a href="#run-1">3 Run ${esc(first.id)}</a><a href="#decision">4 Decision</a><a href="#run-2">5 Run ${esc(last.id)}</a><a href="#seeded">Seeded fault</a>
</div></nav>

<main>
<section class="band" id="legacy"><div class="band-in two">
  <div>
    <h2>The original: low-code tables and a calculation nobody may read</h2>
    <p>${num(sample.counts.tenants)} tenants, ${num(sample.counts.employees)} employees and ${num(sample.counts.shifts)} shifts, generated from a fixed seed. Start and end are stored as local wall-clock time with no zone; each tenant has a time zone. The legacy function <code>legacy.fn_timesheet()</code> returns paid hours and gross pay per payable shift. The migration session was denied read access to its source.</p>
    <h3>Tenants</h3>${rowsTable(sample.tenants)}
    <h3>Employees (first two per tenant)</h3>${rowsTable(sample.employees)}
    <h3>Shifts (first two per tenant)</h3>${rowsTable(sample.shifts)}
  </div>
  <aside class="doc"><p class="doc-h">The brief, as the agent received it</p><div class="doc-body">${md(brief, 2)}</div></aside>
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
      <p>${num(meta?.guardAudit?.transcripts ?? 0)} transcripts audited, ${num(meta?.guardAudit?.toolCalls ?? 0)} tool calls, <b>${(meta?.guardAudit?.findings ?? []).length} leaks</b>. ${blocked.length} calls were stopped; ${blockedNow.filter((b) => !b.stillBlocked).length} of them are not stopped by today's rules (false positives fixed after the run).</p>
      <div class="scroll"><table class="code"><thead><tr><th>Tool</th><th>Call</th><th>Stopped today</th></tr></thead><tbody>${
        blockedNow.map((b) => `<tr><td>${esc(b.tool)}</td><td>${esc(b.input.slice(0, 90))}${b.input.length > 90 ? '…' : ''}</td><td>${b.stillBlocked ? 'yes' : 'no'}</td></tr>`).join('')}</tbody></table></div>
    </div>
  </div>
  <h3>What the agent produced: the mapping</h3>
  <div class="doc wide"><div class="doc-body">${md(mapping, 2)}</div></div>
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
  <h2>The decision: ${decisionCount} open questions settled, ${knowledge.length} lessons written down</h2>
  ${decisionsRun ? `<div class="doc wide"><div class="doc-body">${md(decisionsRun.decisions!, 2)}</div></div>` : '<p>No decisions recorded.</p>'}
  <div class="cards">${knowledge.map((k) => {
    const part = (label: string) => (new RegExp(`^${label}:\\s*([\\s\\S]*?)(?=^\\w+:|$(?![\\s\\S]))`, 'm').exec(k.body)?.[1] ?? '').trim();
    return `<article class="card"><h3>${esc(k.meta.title ?? k.file)}</h3><p class="src">${esc(k.meta.scope ?? '')} · ${esc(k.meta.source ?? '')}</p><dl><dt>Rule</dt><dd>${md(part('Rule'), 3)}</dd><dt>Why</dt><dd>${md(part('Why'), 3)}</dd><dt>Check</dt><dd>${md(part('Check'), 3)}</dd></dl></article>`;
  }).join('')}</div>
</div></section>

<section class="band" id="run-2"><div class="band-in">
  <h2>Run ${esc(last.id)}: ${rl.summary.passed} of ${rl.summary.checks} checks passed after the decisions</h2>
  <ul class="figs">
    <li><b>${meta?.harnessRuns ?? runs.length}</b><span>harness runs</span></li>
    <li><b>${meta?.session?.humanStops ?? '?'}</b><span>human stops</span></li>
    <li><b>${meta?.knowledgeEntriesAtStart ?? 0} → ${meta?.knowledgeEntriesAtEnd ?? knowledge.length}</b><span>knowledge entries</span></li>
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

<section class="band fault" id="seeded"><div class="band-in">
  <p>${seededPill}</p>
  <h2>${esc(seeded.label)}</h2>
  <p>To prove the harness itself works, it was run against a deliberately wrong calculation: <b>${esc(seeded.fault)}</b> Every other rule is right. It reported ${seeded.summary.mismatches} differences on ${seededTenants} shifts, all on the nights the Auckland clocks change, and none in the Brisbane control.${
    seeded.summary.mismatches > 0 && seeded.totals.every((t: Total) => t.ok)
      ? ` Every tenant total still matched: the same staff gained an hour on one clock-change night and lost it on the other, so a check on tenant totals alone would have passed. The per-employee weekly totals (${seeded.weeklyTotals.differing} of ${seeded.weeklyTotals.groups} weeks differ) and the record-by-record check caught it.`
      : ''}</p>
  <div class="two narrow-right">
    <div>${mismatchTable(seeded.mismatches, tenantNames)}</div>
    <div><h3>Assertions</h3>${checksTable(seeded.assertions)}<h3>Totals</h3>${totalsTable(seeded.totals)}</div>
  </div>
</div></section>
</main>

<footer class="band"><div class="band-in">
  <p><b>What this is not.</b> No hosted backend or live database behind this page, no real Cognito (tokens are signed locally), no custom agent loop (the agent is Claude Code), and one feature only. All names and numbers are synthetic; every figure above is read from a file in the repository.</p>
  <p><a href="${REPO_URL}">${esc(REPO_URL.replace('https://', ''))}</a> · built from commit-tracked run files</p>
</div></footer>`;

  const data = { runs: runs.map((r) => ({ id: r.id, summary: r.report.summary, checks: r.report.checks })), seeded: seeded.summary, knowledge: knowledge.map((k) => k.meta.title) };
  const template = await text('site/template.html');
  const html = template
    .replace('<!--CONTENT-->', content)
    .replace('<!--DATA-->', JSON.stringify(data).replace(/</g, '\\u003c'));
  await mkdir(at('site/dist/'), { recursive: true });
  await writeFile(at('site/dist/index.html'), html);
  console.log(`site: site/dist/index.html (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
});
