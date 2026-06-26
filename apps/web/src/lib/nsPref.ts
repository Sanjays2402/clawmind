// Persisted namespace selection for the chat surface.
//
// ChatShell used to hard-code its active namespaces (['memory', 'projects',
// 'sessions']) in a useState initialiser, so every full reload threw away
// whatever the reader had toggled in the breadcrumb picker. A daily user who
// works mostly in `projects` had to re-narrow the workspace on every visit.
//
// This module owns that small preference, keyed in localStorage. The pure
// core (parse / serialize / sanitize) takes no I/O so it can be unit-tested
// directly; readNsPref / writeNsPref are the thin, SSR-safe wrappers ChatShell
// calls from a mount effect (NOT the initial render, so there's no hydration
// mismatch against the server-rendered default).

import type { Ns } from '@clawmind/ui';

/** The full set of valid namespaces, mirroring NamespacePicker's ALL. Kept
 *  here as the validation allow-list so a stale/forged stored value can never
 *  inject an unknown namespace into the picker. */
export const VALID_NS: readonly Ns[] = ['memory', 'projects', 'sessions', 'docs', 'misc'];

/** localStorage key for the chat namespace selection. */
export const NS_PREF_KEY = 'cm-chat-namespaces';

const VALID_SET = new Set<string>(VALID_NS);

/**
 * Filter an arbitrary string array down to the known namespaces, preserving
 * the input order and dropping duplicates. Anything not in VALID_NS is
 * discarded so a corrupt or out-of-date stored value is always coerced to a
 * safe subset rather than trusted blindly.
 */
export function sanitizeNs(input: readonly string[]): Ns[] {
  const out: Ns[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (VALID_SET.has(raw) && !seen.has(raw)) {
      seen.add(raw);
      out.push(raw as Ns);
    }
  }
  return out;
}

/**
 * Parse a stored preference value. Returns a sanitized Ns[] on success, or
 * null when the value is absent, malformed, not an array, or sanitizes to an
 * empty list. A null result tells the caller to keep its own default — we
 * deliberately do NOT persist "no namespaces selected" as a preference, since
 * an empty selection would silently search nothing on the next visit.
 */
export function parseNsPref(raw: string | null): Ns[] | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const strings = parsed.filter((x): x is string => typeof x === 'string');
  const clean = sanitizeNs(strings);
  return clean.length > 0 ? clean : null;
}

/** Serialize a selection to its stored form (a JSON array of namespace ids). */
export function serializeNsPref(ns: readonly Ns[]): string {
  return JSON.stringify(sanitizeNs(ns));
}

/**
 * Read the persisted namespace selection. SSR-safe (returns null when there is
 * no localStorage) and swallows access errors (private mode), so it's safe to
 * call from a mount effect. A null result means "no usable saved preference";
 * the caller keeps its default.
 */
export function readNsPref(): Ns[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return parseNsPref(localStorage.getItem(NS_PREF_KEY));
  } catch {
    return null;
  }
}

/**
 * Persist the namespace selection. An empty (or all-invalid) selection clears
 * the stored preference rather than saving an empty list, so the next visit
 * falls back to the default instead of searching nothing. No-op (swallowed)
 * when localStorage is unavailable.
 */
export function writeNsPref(ns: readonly Ns[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const clean = sanitizeNs(ns);
    if (clean.length === 0) {
      localStorage.removeItem(NS_PREF_KEY);
      return;
    }
    localStorage.setItem(NS_PREF_KEY, JSON.stringify(clean));
  } catch {
    /* ignore persistence failure (private mode / quota) */
  }
}
