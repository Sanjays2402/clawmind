import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { Document } from '@clawmind/types';
import { shortHash } from '../hash.js';
import { inferNamespace } from '../namespace.js';

export interface LoadedHtml {
  doc: Document;
  body: string;
}

/** Returns true for paths the HTML loader should handle. */
export function isHtmlFile(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return ext === '.html' || ext === '.htm';
}

// Tags whose content is opaque (scripts, styles, embedded data) and should be
// stripped entirely rather than flattened to text.
const OPAQUE_TAGS = ['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'object'];

// Block-level tags that should produce a line break in the extracted text so
// the semantic chunker can see paragraph and section boundaries.
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'div', 'dl', 'dt', 'dd',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

// Minimal named entity table covering the entities that actually show up in
// the wild often enough to matter. Numeric entities are handled separately.
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122',
  hellip: '\u2026', mdash: '\u2014', ndash: '\u2013',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, ent: string) => {
    if (ent.startsWith('#x') || ent.startsWith('#X')) {
      const code = parseInt(ent.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    if (ent.startsWith('#')) {
      const code = parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[ent.toLowerCase()] ?? '';
  });
}

/**
 * Strip HTML markup down to a plain-text body, inserting newlines at block
 * boundaries so downstream chunkers see paragraphs. Also extracts the
 * `<title>` tag when present.
 */
export function htmlToText(html: string): { text: string; title?: string } {
  let s = html;

  // Drop everything between opaque tag pairs (case-insensitive, dotall).
  for (const tag of OPAQUE_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, 'gi');
    s = s.replace(re, ' ');
    // Self-closing or unclosed opaque tags: just drop the tag itself.
    s = s.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), ' ');
  }

  // Strip HTML comments and DOCTYPE/CDATA wrappers.
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ' ');
  s = s.replace(/<![^>]*>/g, ' ');

  // Extract <title>.
  let title: string | undefined;
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(s);
  if (titleMatch) {
    title = decodeEntities(titleMatch[1] ?? '').replace(/\s+/g, ' ').trim() || undefined;
  }

  // Replace block tags with newlines, other tags with a space.
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g, (_, raw: string) => {
    return BLOCK_TAGS.has(raw.toLowerCase()) ? '\n' : ' ';
  });

  // Decode entities, then collapse whitespace while keeping paragraph breaks.
  s = decodeEntities(s);
  s = s.replace(/\r\n?/g, '\n');
  s = s.replace(/[ \t\f\v]+/g, ' ');
  s = s.replace(/ *\n */g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.trim();

  return { text: s, title };
}

export async function loadHtml(path: string): Promise<LoadedHtml> {
  const raw = await readFile(path, 'utf8');
  const st = await stat(path);
  const { text, title } = htmlToText(raw);
  const fallback = basename(path, extname(path));
  const doc: Document = {
    id: shortHash(path),
    path,
    namespace: inferNamespace(path),
    title: title ?? fallback,
    mtime: st.mtimeMs,
    size: st.size,
    hash: shortHash(text),
    language: 'html',
  };
  return { doc, body: text };
}
