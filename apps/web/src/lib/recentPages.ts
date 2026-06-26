// Recently-visited pages for the command palette.
//
// The palette (mod+K) lists every route, but a daily user keeps jumping to the
// same handful. This module records the routes you actually visit (most-recent
// first) so the palette can float them to the top under a "Recent" section.
//
// Storage is a plain JSON array of pathnames in localStorage. The pure core
// (parseRecent / pushRecent) takes no I/O so it can be unit-tested directly;
// readRecent / recordRecent are the thin, SSR-safe wrappers the recorder
// component and the palette call. Pathnames are stored raw; the palette is
// responsible for mapping them onto known routes and de-duplicating there (so
// /settings/security and /settings/sso both surface a single "Settings").

/** localStorage key holding the JSON array of recent pathnames. */
export const RECENT_KEY = 'cm-recent-pages';

/** How many raw pathnames we retain. Deliberately a little larger than the
 *  number the palette shows, because several raw paths can collapse onto one
 *  route once the palette de-dupes (e.g. many settings sub-pages). */
export const RECENT_MAX = 12;

/**
 * Parse the stored value defensively. Returns [] on missing/malformed JSON or
 * a non-array shape, and keeps only non-empty strings, capped at RECENT_MAX,
 * so a corrupt key can never throw into the renderer.
 */
export function parseRecent(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const v of parsed) {
      if (typeof v === 'string' && v.length > 0) out.push(v);
    }
    return out.slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

/**
 * Pure update: a NEW list with `path` moved to the front, any prior occurrence
 * removed (so the most-recent visit wins and there are no duplicates), capped
 * at `max`. An empty path is ignored (returns the list unchanged).
 */
export function pushRecent(path: string, list: string[], max = RECENT_MAX): string[] {
  if (!path) return list;
  const next = [path, ...list.filter((p) => p !== path)];
  return next.slice(0, Math.max(0, max));
}

/**
 * Read the recent pathnames (most-recent first). SSR-safe (returns [] when
 * there is no localStorage) and swallows access errors (private mode), so it
 * is safe to call from an effect.
 */
export function readRecent(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    return parseRecent(localStorage.getItem(RECENT_KEY));
  } catch {
    return [];
  }
}

/**
 * Record a visit to `path`, moving it to the front of the recent list. No-op
 * (swallowed) when localStorage is unavailable or the path is empty.
 */
export function recordRecent(path: string): void {
  if (typeof localStorage === 'undefined' || !path) return;
  try {
    const next = pushRecent(path, parseRecent(localStorage.getItem(RECENT_KEY)));
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore persistence failure (private mode / quota) */
  }
}

/**
 * Map a raw visited pathname onto the best-matching route href from `hrefs`,
 * collapsing detail/sub-pages onto their owning route. A href matches when the
 * path equals it or sits beneath it (`/settings/security` -> `/settings`); the
 * MOST specific (longest) matching href wins so `/sources/view` prefers
 * `/sources` over a hypothetical `/`. Query/hash are stripped first. Returns
 * null when nothing matches. Pure, so the palette's recent section is testable.
 */
export function bestRouteHref(path: string, hrefs: string[]): string | null {
  const clean = (path.split(/[?#]/)[0] ?? '').replace(/\/+$/, '') || '/';
  let best: string | null = null;
  for (const href of hrefs) {
    if (clean === href || clean.startsWith(href + '/')) {
      if (best === null || href.length > best.length) best = href;
    }
  }
  return best;
}
