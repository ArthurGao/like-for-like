// Minimal Markdown to HTML for the repo's own files (headings, paragraphs, lists, tables, code,
// front matter). Every piece of text is escaped; no raw HTML from the source is passed through.
export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:]|$)/g, '$1<em>$2</em>');
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/** Split YAML-ish front matter (key: value lines) from the body. */
export function frontMatter(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = Object.fromEntries(
    m[1]!.split('\n').map((l) => l.split(/:\s*/, 2)).filter((kv) => kv.length === 2).map(([k, v]) => [k!.trim(), v!.trim()]),
  );
  return { meta, body: text.slice(m[0].length) };
}

/** headingShift: 1 turns "#" into <h2>, and so on. */
export function md(text: string, headingShift = 1): string {
  const lines = frontMatter(text).body.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    const fence = /^\s*```/.exec(line);
    if (fence) {
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]!); i++) code.push(lines[i]!);
      i++;
      out.push(`<div class="scroll"><pre><code>${esc(code.join('\n'))}</code></pre></div>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(6, h[1]!.length + headingShift);
      out.push(`<h${level}>${inline(h[2]!)}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      const body: string[][] = [];
      for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]!); i++) body.push(cells(lines[i]!));
      out.push(`<div class="scroll"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
        body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const li = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      const ordered = /\d/.test(li[2]!);
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]!);
        if (m) { items.push(m[3]!); i++; continue; }
        if (/^\s{2,}\S/.test(lines[i]!) && items.length) { items[items.length - 1] += ` ${lines[i]!.trim()}`; i++; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|\s*```|\s*\||\s*([-*]|\d+\.)\s)/.test(lines[i]!)) para.push(lines[i++]!.trim());
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}
