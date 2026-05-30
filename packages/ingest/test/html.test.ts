import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { htmlToText, decodeEntities, isHtmlFile, loadHtml } from '../src/loaders/html.js';

describe('isHtmlFile', () => {
  it('matches .html and .htm regardless of case', () => {
    expect(isHtmlFile('/x/a.html')).toBe(true);
    expect(isHtmlFile('/x/a.HTM')).toBe(true);
    expect(isHtmlFile('/x/a.md')).toBe(false);
  });
});

describe('decodeEntities', () => {
  it('handles named, decimal, and hex entities', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot;')).toBe('a & b <c> "d"');
    expect(decodeEntities('&#65;&#x42;')).toBe('AB');
    expect(decodeEntities('&nbsp;&hellip;&mdash;')).toBe(' \u2026\u2014');
  });

  it('drops unknown named entities silently', () => {
    expect(decodeEntities('a &bogus; b')).toBe('a  b');
  });
});

describe('htmlToText', () => {
  it('strips script and style blocks entirely', () => {
    const html = '<html><head><style>p{color:red}</style><script>alert(1)</script></head><body><p>Hello</p></body></html>';
    const { text } = htmlToText(html);
    expect(text).toContain('Hello');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
  });

  it('preserves block boundaries as newlines', () => {
    const { text } = htmlToText('<p>one</p><p>two</p><div>three</div>');
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(lines).toEqual(['one', 'two', 'three']);
  });

  it('extracts <title>', () => {
    const { title } = htmlToText('<html><head><title>  Hello World  </title></head><body>x</body></html>');
    expect(title).toBe('Hello World');
  });

  it('decodes entities in the body', () => {
    const { text } = htmlToText('<p>Tom &amp; Jerry &#8212; pals</p>');
    expect(text).toContain('Tom & Jerry \u2014 pals');
  });

  it('collapses whitespace but keeps paragraph breaks', () => {
    const { text } = htmlToText('<p>a   b</p>\n\n\n<p>c</p>');
    expect(text).toBe('a b\n\nc');
  });

  it('handles comments and DOCTYPE', () => {
    const { text } = htmlToText('<!doctype html><!-- secret --><p>visible</p>');
    expect(text).toBe('visible');
  });
});

describe('loadHtml', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'clawmind-html-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('loads a file and uses the <title> when present', async () => {
    const p = join(dir, 'page.html');
    await writeFile(p, '<html><head><title>My Page</title></head><body><p>Body text</p></body></html>');
    const { doc, body } = await loadHtml(p);
    expect(doc.title).toBe('My Page');
    expect(doc.language).toBe('html');
    expect(doc.path).toBe(p);
    expect(body).toContain('Body text');
  });

  it('falls back to basename when no <title>', async () => {
    const p = join(dir, 'no-title.html');
    await writeFile(p, '<p>just a paragraph</p>');
    const { doc } = await loadHtml(p);
    expect(doc.title).toBe('no-title');
  });
});
