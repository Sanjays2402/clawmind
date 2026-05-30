import { tokenize } from '@clawmind/store';

// Lightweight query expansion. Two jobs:
//   1. Fix obvious typos by snapping rare query tokens to the closest term in
//      the index vocabulary (Damerau-Levenshtein distance 1, plus a length
//      guard so we don't rewrite short tokens into unrelated short tokens).
//   2. Add a handful of domain synonyms so "screenshot" hits notes that say
//      "screen capture" and vice versa. Pure data, no model call.
//
// Designed to be safe to run on every query: when in doubt, leave the token
// alone. Returns the expanded query and a list of corrections so the caller
// can show "searched for X (you typed Y)" in the UI.

export interface ExpandOptions {
  vocab?: Iterable<string>;
  synonyms?: Record<string, string[]>;
  maxAdded?: number;
  minVocabFreq?: number;
}

export interface Expansion {
  original: string;
  expanded: string;
  added: string[];
  corrections: Array<{ from: string; to: string }>;
}

export const DEFAULT_SYNONYMS: Record<string, string[]> = {
  screenshot: ['capture', 'snip'],
  capture: ['screenshot'],
  snip: ['screenshot'],
  ocr: ['text', 'recognition'],
  rag: ['retrieval', 'augmented'],
  llm: ['model'],
  embed: ['embedding', 'vector'],
  embedding: ['embed', 'vector'],
  vector: ['embedding'],
  prompt: ['instruction'],
  bug: ['issue', 'defect'],
  issue: ['bug'],
  fix: ['patch', 'repair'],
  commit: ['change'],
  pr: ['pull', 'request'],
  cli: ['command', 'line'],
  api: ['endpoint', 'route'],
  route: ['endpoint'],
  endpoint: ['route'],
  workspace: ['repo', 'project'],
  repo: ['repository'],
  doc: ['document', 'note'],
  note: ['memo'],
  memo: ['note'],
};

function damerauLevenshtein(a: string, b: string, cap = 2): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
      if (
        i > 1 && j > 1 &&
        a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]
      ) {
        v = Math.min(v, dp[i - 2]![j - 2]! + 1);
      }
      dp[i]![j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cap) return cap + 1;
  }
  return dp[m]![n]!;
}

function bestMatch(token: string, vocab: Map<string, number>, minFreq: number): string | null {
  if (token.length < 4) return null;
  let best: { term: string; dist: number; freq: number } | null = null;
  for (const [term, freq] of vocab) {
    if (freq < minFreq) continue;
    if (Math.abs(term.length - token.length) > 1) continue;
    const d = damerauLevenshtein(token, term, 1);
    if (d > 1) continue;
    if (!best || freq > best.freq) best = { term, dist: d, freq };
  }
  return best?.term ?? null;
}

export function expandQuery(query: string, opts: ExpandOptions = {}): Expansion {
  const syn = opts.synonyms ?? DEFAULT_SYNONYMS;
  const maxAdded = opts.maxAdded ?? 6;
  const minFreq = opts.minVocabFreq ?? 2;

  const vocabFreq = new Map<string, number>();
  if (opts.vocab) {
    for (const t of opts.vocab) vocabFreq.set(t, (vocabFreq.get(t) ?? 0) + 1);
  }

  const tokens = tokenize(query);
  const corrections: Array<{ from: string; to: string }> = [];
  const corrected = tokens.map((t) => {
    if (vocabFreq.size === 0 || vocabFreq.has(t)) return t;
    const match = bestMatch(t, vocabFreq, minFreq);
    if (match && match !== t) {
      corrections.push({ from: t, to: match });
      return match;
    }
    return t;
  });

  const added: string[] = [];
  const seen = new Set(corrected);
  for (const t of corrected) {
    const expansions = syn[t];
    if (!expansions) continue;
    for (const e of expansions) {
      if (added.length >= maxAdded) break;
      if (!seen.has(e)) {
        seen.add(e);
        added.push(e);
      }
    }
    if (added.length >= maxAdded) break;
  }

  // Preserve original casing/punctuation for the answer prompt by appending
  // corrections and synonyms instead of replacing the source text. If we made
  // corrections, swap those in.
  let expanded = query;
  for (const { from, to } of corrections) {
    const re = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    expanded = expanded.replace(re, to);
  }
  if (added.length > 0) expanded = `${expanded} ${added.join(' ')}`;

  return { original: query, expanded, added, corrections };
}

export function vocabFromIndex(idx: { vocab(): IterableIterator<[string, number]> }): string[] {
  // Expand `[term, df]` into a flat array repeated by df so callers can feed it
  // into expandQuery's frequency-weighted vocab without exposing a Map.
  const out: string[] = [];
  for (const [t, f] of idx.vocab()) {
    for (let i = 0; i < f; i++) out.push(t);
  }
  return out;
}
