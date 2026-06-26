// Line-permalink math for the source viewer.
//
// The viewer can be opened on a citation deep-link carrying a cited band
// (?start=&end=). But a reader looking at the file often wants to point a
// colleague at a DIFFERENT line than the one the answer cited. These helpers
// turn a gutter-number click into (a) the new selection and (b) the shareable
// URL, with a shift-click extending the current band into a range.
//
// Pure + I/O-free so the whole thing is unit-testable; CodeView does the
// router.push + clipboard write on top of these.

export interface LineRange {
  start: number;
  end: number;
}

/**
 * Compute the new cited selection from a gutter click.
 *
 * - Plain click  -> a single-line band on the clicked line.
 * - Shift+click  -> extend from the CURRENT band's start anchor to the clicked
 *   line, so the reader can sweep `start`, then shift-click further down to
 *   cover a contiguous range in either direction. With no current band a
 *   shift-click behaves like a plain click (nothing to anchor to).
 *
 * The clicked line is floored + clamped to >= 1 so a bad value can never
 * produce a negative or fractional anchor.
 */
export function lineSelection(
  clicked: number,
  current: LineRange | null,
  shift: boolean,
): LineRange {
  const line = Math.max(1, Math.floor(clicked));
  if (shift && current) {
    const anchor = Math.max(1, Math.floor(current.start));
    return { start: Math.min(anchor, line), end: Math.max(anchor, line) };
  }
  return { start: line, end: line };
}

/**
 * The query string (no leading `?`) for a line selection: path, start, end.
 * `pad` is deliberately omitted so a shared permalink lands on the viewer's
 * default context window rather than baking in whatever the sharer had
 * expanded to. The path is URL-encoded so spaces and slashes survive.
 */
export function lineQueryString(path: string, sel: LineRange): string {
  const params = new URLSearchParams();
  params.set('path', path);
  params.set('start', String(sel.start));
  params.set('end', String(sel.end));
  return params.toString();
}

/** Relative viewer href for a line selection, for client-side router.push. */
export function lineLinkHref(path: string, sel: LineRange): string {
  return `/sources/view?${lineQueryString(path, sel)}`;
}

/**
 * Absolute, shareable permalink for a line selection. `origin` is the page
 * origin (e.g. `https://app.example.com`); a trailing slash on it is tolerated
 * so callers can pass `window.location.origin` without trimming.
 */
export function linePermalink(origin: string, path: string, sel: LineRange): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}${lineLinkHref(path, sel)}`;
}

/**
 * Human label for the copied-link toast: "line 12" or "lines 12-18".
 */
export function lineRangeLabel(sel: LineRange): string {
  return sel.end > sel.start ? `lines ${sel.start}-${sel.end}` : `line ${sel.start}`;
}
