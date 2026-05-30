import { tokenize } from '@clawmind/store';
import type { RetrievedChunk } from '@clawmind/types';

/** A single matched span inside a chunk's text, expressed as character offsets. */
export interface HighlightSpan {
  /** Inclusive start offset within the chunk text. */
  start: number;
  /** Exclusive end offset within the chunk text. */
  end: number;
  /** The original token (lowercased) that matched. */
  term: string;
}

export interface ChunkSnippet {
  /** A short excerpt of the chunk text centred on the densest match window. */
  text: string;
  /** Offset of `text` inside the chunk's full text. */
  offset: number;
  /** Highlight spans expressed as offsets within `text` (not the full chunk). */
  highlights: HighlightSpan[];
  /** The 1-based line number of the snippet inside the source file. */
  startLine: number;
}

/**
 * Find every occurrence of the given terms inside `text`. Matches are
 * whole-word, case-insensitive, and returned in source order. Overlapping
 * matches for the same span (for example a synonym and the original term both
 * matching) are deduplicated, with the longer span winning.
 */
export function findMatches(text: string, terms: Iterable<string>): HighlightSpan[] {
  const cleaned = [...new Set([...terms].map((t) => t.toLowerCase()).filter((t) => t.length >= 2))];
  if (cleaned.length === 0) return [];
  // Escape regex metacharacters in each term and require word boundaries.
  const escaped = cleaned.map((t) => t.replace(/[.+^${}()|[\]\\*?]/g, '\\$&'));
  const re = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
  const out: HighlightSpan[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, term: m[0].toLowerCase() });
    // Guard against zero-length matches looping forever (defensive).
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  // Deduplicate identical spans, keep the longer one when nested.
  out.sort((a, b) => a.start - b.start || b.end - a.end - (b.start - a.start));
  const dedup: HighlightSpan[] = [];
  for (const s of out) {
    const last = dedup[dedup.length - 1];
    if (last && last.start === s.start) continue;
    dedup.push(s);
  }
  return dedup;
}

/**
 * Pick a snippet window of roughly `width` characters that contains the
 * densest cluster of matches. Snaps to word boundaries on both sides.
 */
export function pickWindow(text: string, matches: HighlightSpan[], width = 240): { start: number; end: number } {
  if (text.length <= width || matches.length === 0) {
    return { start: 0, end: Math.min(text.length, width) };
  }
  // Slide a window of size `width` and count matches inside it.
  let best = { start: 0, count: 0 };
  for (const m of matches) {
    const winStart = Math.max(0, m.start - Math.floor(width / 3));
    const winEnd = Math.min(text.length, winStart + width);
    let count = 0;
    for (const other of matches) {
      if (other.start >= winStart && other.end <= winEnd) count++;
    }
    if (count > best.count) best = { start: winStart, count };
  }
  let start = best.start;
  let end = Math.min(text.length, start + width);
  // Snap to whitespace boundaries when possible.
  while (start > 0 && !/\s/.test(text[start - 1]!) && start > best.start - 20) start--;
  while (end < text.length && !/\s/.test(text[end]!) && end < best.start + width + 20) end++;
  return { start, end };
}

/**
 * Render a snippet for a retrieved chunk by selecting a window around the
 * densest match cluster and returning highlight spans relative to the
 * snippet (not the chunk).
 */
export function snippetFor(chunk: RetrievedChunk, terms: Iterable<string>, width = 240): ChunkSnippet {
  const text = chunk.text;
  const matches = findMatches(text, terms);
  const window = pickWindow(text, matches, width);
  let body = text.slice(window.start, window.end);
  // Add ellipses when we trimmed either side.
  const leftCut = window.start > 0;
  const rightCut = window.end < text.length;
  const leftMark = leftCut ? '... ' : '';
  const rightMark = rightCut ? ' ...' : '';
  const relHighlights: HighlightSpan[] = [];
  for (const m of matches) {
    if (m.start >= window.start && m.end <= window.end) {
      relHighlights.push({
        start: m.start - window.start + leftMark.length,
        end: m.end - window.start + leftMark.length,
        term: m.term,
      });
    }
  }
  body = leftMark + body + rightMark;
  // Map the snippet start back to a source line number.
  const newlinesBefore = chunk.text.slice(0, window.start).split('\n').length - 1;
  const startLine = chunk.startLine + newlinesBefore;
  return { text: body, offset: window.start, highlights: relHighlights, startLine };
}

/** Convenience: extract the unique tokens (post-stopword) from a query string. */
export function queryTerms(q: string): string[] {
  return [...new Set(tokenize(q))];
}
