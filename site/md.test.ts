import { describe, expect, it } from 'vitest';
import { esc, frontMatter, md } from './md.ts';

describe('md', () => {
  it('escapes markup in every kind of block', () => {
    const html = md('# A <b>\n\nText <script>x</script> & "q"\n\n- item <i>\n\n```\n<tag>\n```');
    expect(html).not.toMatch(/<(script|b|i|tag)>/);
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; &quot;q&quot;');
    expect(esc(`'`)).toBe('&#39;');
  });

  it('shifts headings and renders inline code, bold and emphasis', () => {
    expect(md('# Title\n\n## Sub', 2)).toBe('<h3>Title</h3>\n<h4>Sub</h4>');
    expect(md('Use `npm test` for **all** of *it*.')).toBe('<p>Use <code>npm test</code> for <strong>all</strong> of <em>it</em>.</p>');
  });

  it('renders tables, ordered lists and wrapped list items', () => {
    const html = md('| A | B |\n|---|---|\n| 1 | `x` |\n\n1. one\n   still one\n2. two');
    expect(html).toContain('<thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td><code>x</code></td></tr></tbody>');
    expect(html).toContain('<ol><li>one still one</li><li>two</li></ol>');
  });

  it('splits front matter from the body', () => {
    const { meta, body } = frontMatter('---\ntitle: T: with colon\nscope: s\n---\nRule: r\n');
    expect(meta).toEqual({ title: 'T: with colon', scope: 's' });
    expect(body).toBe('Rule: r\n');
    expect(md('---\ntitle: x\n---\nHello')).toBe('<p>Hello</p>');
  });
});
