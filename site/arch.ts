// The system diagram: who talks to whom, where the agent is fenced in, and where a person
// decides. Hand-placed on a grid; each node and arrow carries the steps (s1..s7) it takes part in.
import { esc } from './md.ts';

type Pt = [number, number];
const W = 1200;
const H = 590;

const steps = (s: number[]) => s.map((n) => `s${n}`).join(' ');

function node(x: number, y: number, w: number, h: number, lines: string[], kind: 'plain' | 'human' | 'box' | 'solid', s: number[], badge = false) {
  const cy = y + h / 2 - (lines.length - 1) * 9;
  const text = lines.map((l, i) => `<text x="${x + w / 2 + (kind === 'human' ? 4 : 0)}" y="${cy + i * 18 + 5}" text-anchor="middle" class="${i === 0 ? 't1' : 't2'}">${esc(l)}</text>`).join('');
  return `<g class="n ${kind} ${steps(s)}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" class="shape"/>${
    kind === 'human' ? `<rect x="${x}" y="${y}" width="9" height="${h}" class="bar"/>` : ''}${text}${
    badge ? `<circle cx="${x + w - 4}" cy="${y + 4}" r="13" class="badge"/><text x="${x + w - 4}" y="${y + 9}" text-anchor="middle" class="badge-t">H</text>` : ''}</g>`;
}

/** A polyline with an arrowhead on its last segment and a label at `at`. */
function arrow(points: Pt[], label: string, at: Pt, s: number[], opts: { anchor?: string; blocked?: boolean } = {}) {
  const [x2, y2] = points.at(-1)!;
  const [x1, y1] = points.at(-2)!;
  const a = Math.atan2(y2 - y1, x2 - x1);
  const tip = (da: number) => `${(x2 - 11 * Math.cos(a + da)).toFixed(1)},${(y2 - 11 * Math.sin(a + da)).toFixed(1)}`;
  const head = opts.blocked
    ? `<path d="M${x2 - 7},${y2 - 7} L${x2 + 7},${y2 + 7} M${x2 - 7},${y2 + 7} L${x2 + 7},${y2 - 7}" class="x"/>`
    : `<polygon points="${x2},${y2} ${tip(0.42)} ${tip(-0.42)}" class="head"/>`;
  return `<g class="e ${opts.blocked ? 'blocked ' : ''}${steps(s)}"><polyline points="${points.map((p) => p.join(',')).join(' ')}" class="line"/>${head}<text x="${at[0]}" y="${at[1]}" text-anchor="${opts.anchor ?? 'start'}" class="lbl">${esc(label)}</text></g>`;
}

/** captions[i] describes step i+1; the page highlights the parts tagged with that step. */
export function archFigure(captions: string[]): string {
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="System diagram: a person sets the brief; the agent, fenced by a guard, migrates the legacy data to the new platform; the harness compares old and new; differences go to a person; decisions become knowledge for the next feature; the session is audited.">
${[
    // the guard fence around the agent's workspace
    `<g class="n fence s2 s3"><rect x="300" y="160" width="600" height="200" rx="6" class="fence-r"/><text x="314" y="350" class="t2">Guard: deny rules, hook, read-only trust base</text></g>`,
    node(40, 30, 200, 70, ['Person', 'brief and rules'], 'human', [1]),
    node(330, 30, 220, 70, ['Knowledge base', 'rules from earlier decisions'], 'plain', [2, 6]),
    node(650, 30, 220, 70, ['Person', 'decides each difference'], 'human', [5, 6]),
    node(40, 190, 200, 60, ['Legacy tables', 'OutSystems-style'], 'plain', [2, 3]),
    node(40, 270, 200, 60, ['Original logic', 'black box'], 'box', [2, 4]),
    node(330, 205, 220, 90, ['Agent', 'a fresh Claude Code session'], 'solid', [1, 2, 3, 6, 7]),
    node(650, 205, 220, 90, ['Feature code', 'mapping, migration,', 'calculation, tests'], 'plain', [3]),
    node(960, 205, 200, 90, ['New platform', 'PostgreSQL,', 'row-level security'], 'plain', [3, 4]),
    node(330, 450, 220, 70, ['Transcript audit', 'result goes to a person'], 'plain', [7], true),
    node(650, 450, 220, 70, ['Harness', 'five checks, no model calls'], 'solid', [4, 5]),
    node(960, 450, 200, 70, ['Run report', 'every difference listed'], 'plain', [4, 5]),
    arrow([[140, 100], [140, 135], [390, 135], [390, 205]], 'brief, rules', [150, 152], [1]),
    arrow([[470, 100], [470, 205]], 'read first', [462, 124], [2, 6], { anchor: 'end' }),
    arrow([[240, 220], [330, 220]], 'schema', [248, 212], [2]),
    arrow([[240, 300], [296, 300]], 'denied', [248, 292], [2], { blocked: true }),
    arrow([[550, 250], [650, 250]], 'writes', [578, 242], [3]),
    arrow([[870, 250], [960, 250]], 'migrates', [884, 242], [3]),
    arrow([[140, 330], [140, 560], [760, 560], [760, 520]], 'original results', [150, 552], [4]),
    arrow([[1060, 295], [1060, 410], [810, 410], [810, 450]], 'new results, as each tenant', [1050, 402], [4], { anchor: 'end' }),
    arrow([[870, 485], [960, 485]], 'report', [888, 477], [4, 5]),
    arrow([[1160, 485], [1185, 485], [1185, 65], [870, 65]], 'differences stop here', [1176, 52], [5], { anchor: 'end' }),
    arrow([[700, 100], [700, 135], [510, 135], [510, 205]], 'decision', [690, 128], [6], { anchor: 'end' }),
    arrow([[650, 50], [550, 50]], 'becomes a rule', [600, 42], [6], { anchor: 'middle' }),
    arrow([[440, 295], [440, 450]], 'every tool call', [448, 410], [7]),
  ].join('\n')}
</svg>`;
  return `<figure class="arch"><div class="scroll arch-sv">${svg}</div>
<ol class="arch-steps">${captions.map((c, i) => `<li><button type="button" data-step="${i + 1}"><b>${i + 1}</b><span>${c}</span></button></li>`).join('')}</ol>
<figcaption>Dark nodes with a red bar, and the red H, are where a person decides. The dashed fence is what the agent may touch.</figcaption></figure>`;
}

export const ARCH_CSS = `
.arch{margin:0}
.arch-sv svg{display:block;width:100%;min-width:760px;height:auto;color:var(--ink)}
.arch .shape{fill:var(--bg);stroke:currentColor;stroke-width:1.5}
.arch .solid .shape{fill:color-mix(in srgb,var(--ink) 10%,var(--bg))}
.arch .box .shape{fill:color-mix(in srgb,var(--ink) 82%,var(--bg))}
.arch .box text{fill:var(--bg)}
.arch .human .shape{fill:var(--ink)}
.arch .human text{fill:var(--bg)}
.arch .bar,.arch .badge{fill:var(--red)}
.arch .badge-t{fill:var(--on-red);font:700 14px "Instrument Sans",system-ui,sans-serif}
.arch .fence-r{fill:none;stroke:currentColor;stroke-width:1.5;stroke-dasharray:7 6}
.arch text{fill:currentColor;font:13px "Instrument Sans",system-ui,sans-serif}
.arch .t1{font-weight:600;font-size:15px}
.arch .lbl{font-size:12px}
.arch .line{fill:none;stroke:currentColor;stroke-width:2}
.arch .head{fill:currentColor}
.arch .x{stroke:var(--red);stroke-width:3;fill:none}
.arch .blocked .line{stroke-dasharray:4 4}
.arch .n,.arch .e{transition:opacity .3s}
.arch[data-at] .n,.arch[data-at] .e{opacity:.18}
${[1, 2, 3, 4, 5, 6, 7].map((n) => `.arch[data-at="${n}"] .s${n}`).join(',')}{opacity:1}
${[1, 2, 3, 4, 5, 6, 7].map((n) => `.arch[data-at="${n}"] .e.s${n}`).join(',')}{color:var(--red)}
${[1, 2, 3, 4, 5, 6, 7].map((n) => `.arch[data-at="${n}"] .e.s${n} .line`).join(',')}{stroke-width:3.5}
.arch-steps{list-style:none;padding:0;margin:12px 0 8px;display:grid;gap:6px;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))}
.arch-steps button{display:grid;grid-template-columns:28px minmax(0,1fr);gap:10px;align-items:start;width:100%;text-align:left;font:inherit;font-size:15px;color:inherit;background:none;border:1.5px solid transparent;border-radius:4px;padding:8px 10px;cursor:pointer}
.arch-steps b{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;border:1.5px solid currentColor;font-size:14px}
.arch-steps button[aria-current=true]{border-color:currentColor}
.arch-steps button[aria-current=true] b{background:var(--red);border-color:var(--red);color:var(--on-red)}
.arch-steps button:focus-visible{outline:3px solid var(--red);outline-offset:2px}
.arch figcaption{font-size:14px;color:var(--mute)}
@media(prefers-reduced-motion:reduce){.arch .n,.arch .e{transition:none}}
`;

/** Gives every .arch element start() and stop(); a click on a step stops the cycle there. */
export const ARCH_JS = `
  const ARCH_STEP_MS = 3000;
  document.querySelectorAll('.arch').forEach((fig) => {
    const buttons = [...fig.querySelectorAll('[data-step]')];
    let timer = 0;
    const at = (n) => { fig.dataset.at = n; buttons.forEach((b) => b.setAttribute('aria-current', String(Number(b.dataset.step) === n))); };
    fig.stop = () => clearInterval(timer);
    fig.start = () => {
      fig.stop();
      let n = 1;
      at(n);
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      timer = setInterval(() => { n = n % buttons.length + 1; at(n); }, ARCH_STEP_MS);
    };
    buttons.forEach((b) => b.addEventListener('click', () => { fig.stop(); at(Number(b.dataset.step)); }));
  });
`;

export const ARCH_STEPS = 7;
export const ARCH_STEP_MS = 3000;
