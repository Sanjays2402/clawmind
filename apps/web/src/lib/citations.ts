// Citation parsing helpers shared between the answer renderer (ChatStream)
// and the chat shell's keyboard navigation. The model emits citation
// markers as `[1]` or `[^2]`; both forms map a 1-based index onto the
// ordered sources array. Keeping the parse in one place means the pills
// rendered in the prose and the `[` / `]` cycle order can never drift.

const CITE_RE = /\[\^?(\d+)\]/g;

/**
 * The DOM id carried by the FIRST citation pill for a given source. The
 * keyboard navigation focuses this element when stepping onto a source.
 */
export function citePillId(id: string): string {
  return 'cm-cite-' + id;
}

/**
 * Parse the answer text for citation markers and return the referenced
 * items in order of FIRST appearance, de-duplicated. Markers that point
 * outside the sources array (a model over-count) are skipped so the cycle
 * only ever contains sources that actually exist in the rail.
 */
export function citedOrder<T>(text: string, sources: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  let m: RegExpExecArray | null;
  CITE_RE.lastIndex = 0;
  while ((m = CITE_RE.exec(text)) !== null) {
    const idx = Number(m[1]) - 1;
    if (idx < 0 || idx >= sources.length || seen.has(idx)) continue;
    const src = sources[idx];
    if (src === undefined) continue;
    seen.add(idx);
    out.push(src);
  }
  return out;
}
