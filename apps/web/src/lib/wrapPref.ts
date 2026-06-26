// Per-file-type soft-wrap preference for the source viewer.
//
// The wrap toggle in CodeView used to persist a single global boolean under
// `cm-code-wrap`, so flipping a Markdown file to "wrap" also flipped every
// .ts file. But a prose file (.md, .txt) usually wants wrap while a code file
// (.ts, .go) usually wants horizontal scroll - so the preference is really
// per-extension. This module owns that small map, keyed by file extension.
//
// The pure core (extOf / defaultWrapForExt / resolveWrap / nextWrapMap) takes
// no I/O so it can be unit-tested directly; readWrapPref / writeWrapPref are
// the thin, SSR-safe localStorage wrappers CodeView actually calls.

/** JSON map of extension -> wrap boolean. */
export type WrapMap = Record<string, boolean>;

/** New per-extension store. A JSON object, so it never collides with the
 *  legacy scalar value that may still live under LEGACY_KEY. */
export const WRAP_MAP_KEY = 'cm-code-wrap-by-ext';
/** Legacy global key: held '0' / '1'. Read as a fallback so an existing
 *  user's single preference still applies until they set a per-ext one. */
export const LEGACY_WRAP_KEY = 'cm-code-wrap';

// Extensions whose content reads as prose and therefore defaults to wrap.
// Everything else defaults to scroll (faithful to the file's own columns).
const PROSE_EXTS = new Set([
  'md',
  'markdown',
  'mdx',
  'txt',
  'text',
  'rst',
  'adoc',
  'asciidoc',
  'org',
]);

/**
 * Lowercased file extension without the dot, or '' when there is none. Handles
 * dotfiles (".gitignore" -> "gitignore"), trailing slashes, and paths with no
 * extension. The extension is taken from the final path segment only, so a dot
 * in a parent directory never leaks in.
 */
export function extOf(path: string): string {
  if (!path) return '';
  const seg = path.split('/').pop() ?? '';
  const dot = seg.lastIndexOf('.');
  // No dot, or a leading dot with nothing after it -> no usable extension.
  if (dot <= 0) {
    // A pure dotfile like ".gitignore": treat the name after the dot as the ext.
    if (dot === 0 && seg.length > 1) return seg.slice(1).toLowerCase();
    return '';
  }
  return seg.slice(dot + 1).toLowerCase();
}

/** The default wrap state for a given extension when the reader hasn't pinned
 *  one: prose-ish files wrap, code files scroll. */
export function defaultWrapForExt(ext: string): boolean {
  return PROSE_EXTS.has(ext);
}

/**
 * Resolve the effective wrap state for an extension from the stored map and an
 * optional legacy global value. Precedence:
 *   1. an explicit per-ext entry (the reader pinned this file type),
 *   2. else the legacy global pref (carried over from the old single key),
 *   3. else the prose-vs-code default for the extension.
 */
export function resolveWrap(
  ext: string,
  map: WrapMap,
  legacy: boolean | null,
): boolean {
  if (Object.prototype.hasOwnProperty.call(map, ext)) return map[ext]!;
  if (legacy !== null) return legacy;
  return defaultWrapForExt(ext);
}

/** Pure update: a NEW map with `ext` set to `wrap` (never mutates the input). */
export function nextWrapMap(ext: string, wrap: boolean, map: WrapMap): WrapMap {
  return { ...map, [ext]: wrap };
}

/** Parse a stored map value defensively; returns {} on any malformed JSON or
 *  non-object shape so a corrupt key can never throw into the renderer. */
export function parseWrapMap(raw: string | null): WrapMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: WrapMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'boolean') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Interpret the legacy scalar value: '1' -> true, '0' -> false, else null. */
export function parseLegacyWrap(raw: string | null): boolean | null {
  if (raw === '1') return true;
  if (raw === '0') return false;
  return null;
}

/**
 * Read the effective wrap state for a file. SSR-safe (returns the plain
 * default when there is no localStorage) and swallows access errors (private
 * mode), so it is safe to call from a mount effect.
 */
export function readWrapPref(path: string): boolean {
  const ext = extOf(path);
  if (typeof localStorage === 'undefined') return defaultWrapForExt(ext);
  try {
    const map = parseWrapMap(localStorage.getItem(WRAP_MAP_KEY));
    const legacy = parseLegacyWrap(localStorage.getItem(LEGACY_WRAP_KEY));
    return resolveWrap(ext, map, legacy);
  } catch {
    return defaultWrapForExt(ext);
  }
}

/** Persist the wrap choice for a file's extension into the per-ext map. No-op
 *  (swallowed) when localStorage is unavailable. */
export function writeWrapPref(path: string, wrap: boolean): void {
  if (typeof localStorage === 'undefined') return;
  const ext = extOf(path);
  try {
    const map = parseWrapMap(localStorage.getItem(WRAP_MAP_KEY));
    const next = nextWrapMap(ext, wrap, map);
    localStorage.setItem(WRAP_MAP_KEY, JSON.stringify(next));
  } catch {
    /* ignore persistence failure (private mode / quota) */
  }
}
