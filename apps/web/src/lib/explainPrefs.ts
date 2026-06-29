// Persisted tuning knobs for the retrieval Explain page.
//
// The Explain page exposes three sliders - hybrid alpha (dense weight), MMR
// lambda (diversity), and top-k - that an operator nudges to feel how the
// ranking shifts. Until now every reload snapped them back to the 0.5/0.5/8
// defaults, throwing away a tuning session the moment the page refreshed (or
// was reopened from a link). This module persists the trio so a session
// survives reload.
//
// The pure core (clampAlpha / clampLambda / clampK / sanitizePrefs) does no
// I/O so it can be unit-tested directly; readExplainPrefs / writeExplainPrefs
// are the thin, SSR-safe localStorage wrappers the page mounts against. Shape
// mirrors lib/wrapPref.ts and lib/nsPref.ts: defensive parse, swallowed access
// errors (private mode / quota), plain defaults when there is no localStorage.

/** The three tuning knobs the Explain sliders bind to. */
export interface ExplainPrefs {
  /** Hybrid blend: dense weight in [0,1]. 1 - alpha is the BM25 weight. */
  alpha: number;
  /** MMR diversity lambda in [0,1]. */
  lambda: number;
  /** Top-k candidates to retrieve, an integer in [1,20]. */
  k: number;
}

/** localStorage key holding the JSON-encoded {@link ExplainPrefs}. */
export const EXPLAIN_PREFS_KEY = 'cm-explain-prefs';

/** The slider defaults, matching the page's initial state before any tuning. */
export const DEFAULT_EXPLAIN_PREFS: ExplainPrefs = { alpha: 0.5, lambda: 0.5, k: 8 };

// Slider bounds, kept in lockstep with the range inputs on the page so a
// persisted value can never drive a slider past its track.
const ALPHA_STEP = 0.05;
const K_MIN = 1;
const K_MAX = 20;

/** Round a unit-interval value to the slider's 0.05 grid and clamp to [0,1]. */
function snapUnit(n: number): number {
  const clamped = Math.max(0, Math.min(1, n));
  // Snap to the 0.05 step so a hand-edited localStorage value still lands on a
  // real slider stop, then round away binary float fuzz (0.30000000000000004).
  return Math.round(clamped / ALPHA_STEP) * ALPHA_STEP;
}

/** Clamp + snap alpha to a valid slider value, falling back to the default. */
export function clampAlpha(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_EXPLAIN_PREFS.alpha;
  return Number(snapUnit(n).toFixed(2));
}

/** Clamp + snap lambda to a valid slider value, falling back to the default. */
export function clampLambda(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_EXPLAIN_PREFS.lambda;
  return Number(snapUnit(n).toFixed(2));
}

/** Clamp k to an integer in [1,20], falling back to the default. */
export function clampK(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_EXPLAIN_PREFS.k;
  return Math.max(K_MIN, Math.min(K_MAX, Math.round(n)));
}

/**
 * Coerce an arbitrary parsed value into a fully-valid {@link ExplainPrefs}.
 * Each field is clamped independently so a single bad knob never discards the
 * other two; a non-object input collapses to the defaults.
 */
export function sanitizePrefs(raw: unknown): ExplainPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_EXPLAIN_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  return {
    alpha: clampAlpha(obj.alpha),
    lambda: clampLambda(obj.lambda),
    k: clampK(obj.k),
  };
}

/** Parse a stored JSON string into prefs; defaults on any malformed input. */
export function parseExplainPrefs(rawJson: string | null): ExplainPrefs {
  if (!rawJson) return { ...DEFAULT_EXPLAIN_PREFS };
  try {
    return sanitizePrefs(JSON.parse(rawJson));
  } catch {
    return { ...DEFAULT_EXPLAIN_PREFS };
  }
}

/**
 * Read the persisted tuning prefs. SSR-safe (returns the plain defaults when
 * there is no localStorage) and swallows access errors (private mode), so it
 * is safe to call from a mount effect.
 */
export function readExplainPrefs(): ExplainPrefs {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_EXPLAIN_PREFS };
  try {
    return parseExplainPrefs(localStorage.getItem(EXPLAIN_PREFS_KEY));
  } catch {
    return { ...DEFAULT_EXPLAIN_PREFS };
  }
}

/** Persist the tuning prefs. No-op (swallowed) when localStorage is
 *  unavailable or full. */
export function writeExplainPrefs(prefs: ExplainPrefs): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(EXPLAIN_PREFS_KEY, JSON.stringify(sanitizePrefs(prefs)));
  } catch {
    /* ignore persistence failure (private mode / quota) */
  }
}
