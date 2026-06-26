// Context-window math for the source viewer.
//
// When a source is opened from a citation, the deep-link carries the exact
// cited line band (start..end). Showing ONLY those lines strands the reader
// with zero surrounding context. These helpers widen the fetched window by a
// fixed pad on each side, then map the original cited band onto the widened
// window so the band can be highlighted in place.

/** Lines of padding shown above and below a cited band in the viewer. */
export const CONTEXT_PAD = 12;

export interface ContextWindow {
  /** First line to fetch (1-based, clamped at 1). */
  fetchStart: number;
  /** Last line to fetch (1-based). `undefined` = to end of file. */
  fetchEnd: number | undefined;
  /** Whether a cited band exists inside the window (i.e. start was given). */
  hasCited: boolean;
  /** The cited band, normalized (1-based inclusive), or null when none. */
  cited: { start: number; end: number } | null;
}

/**
 * Widen a cited (start, end) band by CONTEXT_PAD on each side. With no `start`
 * the whole file is fetched and there is no cited band to highlight. `end`
 * defaults to `start` (a single cited line) when omitted but `start` is given.
 */
export function contextWindow(
  start: number | undefined,
  end: number | undefined,
  pad: number = CONTEXT_PAD,
): ContextWindow {
  if (!start || start < 1) {
    return { fetchStart: 1, fetchEnd: end && end >= 1 ? end : undefined, hasCited: false, cited: null };
  }
  const citedStart = Math.max(1, Math.floor(start));
  const citedEnd = Math.max(citedStart, Math.floor(end ?? citedStart));
  const fetchStart = Math.max(1, citedStart - pad);
  const fetchEnd = citedEnd + pad;
  return {
    fetchStart,
    fetchEnd,
    hasCited: true,
    cited: { start: citedStart, end: citedEnd },
  };
}

/**
 * Is the absolute file line `lineNo` inside the cited band? Used by the
 * renderer to decide which rows get the highlight treatment.
 */
export function isCitedLine(win: ContextWindow, lineNo: number): boolean {
  if (!win.cited) return false;
  return lineNo >= win.cited.start && lineNo <= win.cited.end;
}

/**
 * Extract the exact cited line text from a fetched window. `content` is the
 * window body (a slice of the file), `startLine` is the absolute 1-based line
 * number of the window's first row (i.e. `fileRes.start`). Returns the joined
 * text of just the cited band — NOT the surrounding context — or null when
 * there's no cited band or it falls entirely outside the fetched window.
 *
 * The returned text intentionally omits a trailing newline so it pastes as a
 * clean block; callers that want one can append it.
 */
export function citedText(
  content: string,
  startLine: number,
  win: ContextWindow,
): string | null {
  if (!win.cited) return null;
  const lines = content.split('\n');
  // Map absolute cited lines onto 0-based indices within the window body.
  const from = Math.max(0, win.cited.start - startLine);
  const to = Math.min(lines.length, win.cited.end - startLine + 1);
  if (to <= from) return null;
  return lines.slice(from, to).join('\n');
}
