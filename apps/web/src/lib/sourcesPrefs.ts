// Persisted list-view preferences for the Sources page.
//
// The Sources page lets you narrow the file list by namespace and re-order it
// (recent / path / chunks). Until now both reset on every full reload, so a
// reader who works mostly in one namespace, sorted by path, had to re-pick the
// pair on every visit. This module persists that small {namespace, sort} pair
// so the view survives a reload.
//
// The pure core (sanitizeSort / sanitizeNamespace / sanitizePrefs / parse /
// serialize) does no I/O so it can be unit-tested directly; readSourcesPrefs /
// writeSourcesPrefs are the thin, SSR-safe localStorage wrappers the page
// mounts against. Shape mirrors lib/explainPrefs.ts and lib/nsPref.ts:
// defensive parse, swallowed access errors (private mode / quota), plain
// defaults when there is no localStorage.

/** Sort keys the Sources list offers, in display order. */
export const SOURCES_SORTS = ['recent', 'path', 'chunks'] as const;
export type SourcesSort = (typeof SOURCES_SORTS)[number];

/** The persisted Sources list-view preferences. */
export interface SourcesPrefs {
  /** Selected namespace, or '' for "All namespaces". */
  namespace: string;
  /** Active sort order. */
  sort: SourcesSort;
}

/** localStorage key holding the JSON-encoded {@link SourcesPrefs}. */
export const SOURCES_PREFS_KEY = 'cm-sources-prefs';

/** Defaults, matching the page's initial state before any selection. */
export const DEFAULT_SOURCES_PREFS: SourcesPrefs = { namespace: '', sort: 'recent' };

const SORT_SET = new Set<string>(SOURCES_SORTS);

/** Coerce an arbitrary value to a valid sort key, falling back to the default. */
export function sanitizeSort(v: unknown): SourcesSort {
  return typeof v === 'string' && SORT_SET.has(v) ? (v as SourcesSort) : DEFAULT_SOURCES_PREFS.sort;
}

/**
 * Coerce an arbitrary value to a namespace string. A namespace is opaque
 * (server-defined), so we can't allow-list it the way nsPref does; instead we
 * defensively accept only a bounded, non-whitespace string and otherwise fall
 * back to '' (All). This keeps a corrupt/huge stored value from ever driving
 * the select to a bogus option.
 */
export function sanitizeNamespace(v: unknown): string {
  if (typeof v !== 'string') return DEFAULT_SOURCES_PREFS.namespace;
  const trimmed = v.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return DEFAULT_SOURCES_PREFS.namespace;
  return trimmed;
}

/**
 * Coerce an arbitrary parsed value into a fully-valid {@link SourcesPrefs}.
 * Each field is sanitized independently so one bad field never discards the
 * other; a non-object input collapses to the defaults.
 */
export function sanitizePrefs(raw: unknown): SourcesPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_SOURCES_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  return {
    namespace: sanitizeNamespace(obj.namespace),
    sort: sanitizeSort(obj.sort),
  };
}

/** Parse a stored JSON string into prefs; defaults on any malformed input. */
export function parseSourcesPrefs(rawJson: string | null): SourcesPrefs {
  if (!rawJson) return { ...DEFAULT_SOURCES_PREFS };
  try {
    return sanitizePrefs(JSON.parse(rawJson));
  } catch {
    return { ...DEFAULT_SOURCES_PREFS };
  }
}

/** Serialize prefs to their stored form (a JSON object). */
export function serializeSourcesPrefs(prefs: SourcesPrefs): string {
  return JSON.stringify(sanitizePrefs(prefs));
}

/**
 * Read the persisted list-view prefs. SSR-safe (returns the plain defaults
 * when there is no localStorage) and swallows access errors (private mode),
 * so it is safe to call from a mount effect.
 */
export function readSourcesPrefs(): SourcesPrefs {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_SOURCES_PREFS };
  try {
    return parseSourcesPrefs(localStorage.getItem(SOURCES_PREFS_KEY));
  } catch {
    return { ...DEFAULT_SOURCES_PREFS };
  }
}

/** Persist the list-view prefs. No-op (swallowed) when localStorage is
 *  unavailable or full. */
export function writeSourcesPrefs(prefs: SourcesPrefs): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SOURCES_PREFS_KEY, serializeSourcesPrefs(prefs));
  } catch {
    /* ignore persistence failure (private mode / quota) */
  }
}
