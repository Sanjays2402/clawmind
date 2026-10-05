// Persisted chat thread + composer draft.
//
// ChatShell holds the running thread in React state only, so a reload, an
// accidental tab close, or a quick hop to /sources and back threw away every
// exchange on screen — and any half-typed question in the composer with it.
//
// This module owns both pieces of state in localStorage. Same shape as
// nsPref: a pure core (parse / serialize / sanitize) with no I/O so it can be
// unit-tested directly, plus thin SSR-safe read/write wrappers that ChatShell
// calls from mount effects (never the initial render, so there's no hydration
// mismatch against the server-rendered empty state).

/** localStorage key for the running thread. */
export const THREAD_KEY = 'cm-chat-thread';
/** localStorage key for the unsent composer draft. */
export const DRAFT_KEY = 'cm-chat-draft';
/** Bumped whenever the stored shape changes; older payloads are discarded. */
export const THREAD_VERSION = 1;
/** Hard cap on persisted exchanges (newest kept) so storage stays bounded. */
export const MAX_TURNS = 50;

/** Message attached to a turn that was still streaming when the page went away. */
export const INTERRUPTED_MESSAGE = 'interrupted by a page reload';

export interface StoredSource {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  score: number;
  displayPath?: string;
}

export interface StoredTurn {
  id: string;
  question: string;
  answer: string;
  sources: StoredSource[];
  error: string | null;
  done: boolean;
  tokens?: number;
  elapsedMs?: number;
}

interface StoredThread {
  v: number;
  turns: StoredTurn[];
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function num(x: unknown, fallback = 0): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

function sanitizeSource(raw: unknown): StoredSource | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || typeof raw.path !== 'string') return null;
  const out: StoredSource = {
    id: raw.id,
    path: raw.path,
    startLine: num(raw.startLine, 1),
    endLine: num(raw.endLine, 1),
    excerpt: typeof raw.excerpt === 'string' ? raw.excerpt : '',
    score: num(raw.score),
  };
  if (typeof raw.displayPath === 'string') out.displayPath = raw.displayPath;
  return out;
}

/**
 * Coerce one stored turn back into a safe shape, or null if it is unusable.
 * A turn that was still streaming when it was saved can never resume (the
 * stream died with the page), so it is closed out: marked done, and flagged
 * with INTERRUPTED_MESSAGE so the existing retry affordance shows up.
 */
export function sanitizeTurn(raw: unknown): StoredTurn | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || typeof raw.question !== 'string') return null;
  if (!raw.question.trim()) return null;
  const sources = Array.isArray(raw.sources)
    ? raw.sources.map(sanitizeSource).filter((s): s is StoredSource => s !== null)
    : [];
  const done = raw.done === true;
  let error = typeof raw.error === 'string' ? raw.error : null;
  if (!done && !error) error = INTERRUPTED_MESSAGE;
  const out: StoredTurn = {
    id: raw.id,
    question: raw.question,
    answer: typeof raw.answer === 'string' ? raw.answer : '',
    sources,
    error,
    done: true,
  };
  if (typeof raw.tokens === 'number' && done) out.tokens = raw.tokens;
  if (typeof raw.elapsedMs === 'number' && done) out.elapsedMs = raw.elapsedMs;
  return out;
}

/**
 * Parse a stored thread. Returns the sanitized turns (newest first, capped at
 * MAX_TURNS), or null when the value is absent, malformed, from another
 * schema version, or holds no usable turns.
 */
export function parseThread(raw: string | null): StoredTurn[] | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(parsed) || parsed.v !== THREAD_VERSION || !Array.isArray(parsed.turns)) return null;
  const turns = parsed.turns
    .map(sanitizeTurn)
    .filter((t): t is StoredTurn => t !== null)
    .slice(0, MAX_TURNS);
  return turns.length > 0 ? turns : null;
}

/**
 * Serialize turns to their stored form. Snippet highlight spans are dropped
 * (they are cheap to lose and are the bulkiest field), and only the newest
 * MAX_TURNS exchanges are kept.
 */
export function serializeThread(turns: readonly StoredTurn[]): string {
  const payload: StoredThread = {
    v: THREAD_VERSION,
    turns: turns.slice(0, MAX_TURNS).map((t) => ({
      id: t.id,
      question: t.question,
      answer: t.answer,
      sources: t.sources.map((s) => {
        const out: StoredSource = {
          id: s.id,
          path: s.path,
          startLine: s.startLine,
          endLine: s.endLine,
          excerpt: s.excerpt,
          score: s.score,
        };
        if (s.displayPath) out.displayPath = s.displayPath;
        return out;
      }),
      error: t.error,
      done: t.done,
      ...(t.tokens != null ? { tokens: t.tokens } : {}),
      ...(t.elapsedMs != null ? { elapsedMs: t.elapsedMs } : {}),
    })),
  };
  return JSON.stringify(payload);
}

/** Read the persisted thread. SSR-safe; null means "nothing to restore". */
export function readThread(): StoredTurn[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return parseThread(localStorage.getItem(THREAD_KEY));
  } catch {
    return null;
  }
}

/**
 * Persist the thread. An empty thread clears the key so "New thread" really
 * starts clean on the next visit. Quota / private-mode failures are swallowed.
 */
export function writeThread(turns: readonly StoredTurn[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (turns.length === 0) {
      localStorage.removeItem(THREAD_KEY);
      return;
    }
    localStorage.setItem(THREAD_KEY, serializeThread(turns));
  } catch {
    /* ignore persistence failure (private mode / quota) */
  }
}

/** Read the unsent composer draft, or '' when there is none. */
export function readDraft(): string {
  if (typeof localStorage === 'undefined') return '';
  try {
    return localStorage.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Persist the composer draft; a blank draft clears the key. */
export function writeDraft(text: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (!text.trim()) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, text);
  } catch {
    /* ignore persistence failure (private mode / quota) */
  }
}
