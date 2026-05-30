import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Document } from '@clawmind/types';
import { shortHash } from '../hash.js';
import { inferNamespace } from '../namespace.js';

/**
 * Extracted PDF content. The body is rendered as plain text with one form-feed
 * (`\f`) between pages so downstream chunkers can keep page boundaries intact.
 * `pageOffsets[i]` is the body offset where page `i` (0-based) starts.
 */
export interface LoadedPdf {
  doc: Document;
  body: string;
  pageCount: number;
  pageOffsets: number[];
}

interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
}

/**
 * Internal: load a PDF with the legacy pdfjs build (which works in Node
 * without a DOM/worker). Returns the per-page text array.
 */
async function readPagesText(absPath: string): Promise<string[]> {
  // Use the legacy build which works in Node without a worker. Import inside
  // the function so callers that never touch PDFs pay no startup cost.
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as {
    getDocument(arg: { data: Uint8Array; disableWorker?: boolean; isEvalSupported?: boolean }): {
      promise: Promise<{
        numPages: number;
        getPage(n: number): Promise<{
          getTextContent(): Promise<{ items: PdfTextItem[] }>;
        }>;
        destroy(): Promise<void>;
      }>;
    };
  };
  const data = new Uint8Array(await readFile(absPath));
  const task = pdfjs.getDocument({
    data,
    disableWorker: true,
    isEvalSupported: false,
    // Suppress "standardFontDataUrl" warnings: we only care about text
    // extraction, not rendering, so missing standard fonts are harmless.
    verbosity: 0,
  } as never);
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      // Join items with spaces; insert newlines where pdfjs marks EOL.
      let buf = '';
      for (const item of content.items) {
        if (typeof item.str === 'string') buf += item.str;
        if (item.hasEOL) buf += '\n';
        else buf += ' ';
      }
      pages.push(buf.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

/** Returns true for paths that the PDF loader should handle. */
export function isPdfFile(path: string): boolean {
  return path.toLowerCase().endsWith('.pdf');
}

/**
 * Load a PDF into a Document plus rendered text body. Page boundaries are
 * preserved with form-feed characters so downstream chunkers can map chunk
 * line ranges back to page numbers if needed.
 */
export async function loadPdf(path: string): Promise<LoadedPdf> {
  const st = await stat(path);
  const pages = await readPagesText(path);
  // Join pages with form-feed. Form-feed counts as a line break for our
  // semantic chunker so each page is at least a chunk boundary candidate.
  const body = pages.join('\n\f\n');
  const pageOffsets: number[] = [];
  let offset = 0;
  for (let i = 0; i < pages.length; i++) {
    pageOffsets.push(offset);
    offset += pages[i]!.length + (i < pages.length - 1 ? 3 : 0); // 3 = "\n\f\n"
  }
  const hash = shortHash(body);
  const doc: Document = {
    id: shortHash(path),
    path,
    namespace: inferNamespace(path),
    title: basename(path, '.pdf'),
    mtime: st.mtimeMs,
    size: st.size,
    hash,
    language: 'pdf',
  };
  return { doc, body, pageCount: pages.length, pageOffsets };
}

/**
 * Given the page offsets produced by `loadPdf` and a 1-based body line range,
 * return the 1-based page number that contains the start of the range.
 */
export function pageForLine(body: string, pageOffsets: number[], line: number): number {
  if (pageOffsets.length === 0 || line <= 0) return 1;
  // Find the byte offset of the start of `line` (1-based).
  let cur = 1;
  let off = 0;
  if (line > 1) {
    for (let i = 0; i < body.length; i++) {
      if (body[i] === '\n') {
        cur += 1;
        if (cur === line) {
          off = i + 1;
          break;
        }
      }
    }
    if (cur < line) off = body.length - 1;
  }
  // Binary search pageOffsets for the largest offset <= off.
  let lo = 0;
  let hi = pageOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pageOffsets[mid]! <= off) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
