import type { RetrievedChunk } from '@clawmind/types';

function dot(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

function cosine(a?: number[], b?: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  const d = dot(a, b);
  let na = 0, nb = 0;
  for (const x of a) na += x * x;
  for (const y of b) nb += y * y;
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? d / denom : 0;
}

export interface MmrOptions {
  lambda?: number;
  k?: number;
  queryVector?: number[];
}

export function mmrRerank(candidates: RetrievedChunk[], opts: MmrOptions = {}): RetrievedChunk[] {
  const lambda = opts.lambda ?? 0.5;
  const k = Math.min(opts.k ?? 8, candidates.length);
  if (k === 0) return [];

  const remaining = [...candidates];
  const selected: RetrievedChunk[] = [];

  // Pick first by relevance
  remaining.sort((a, b) => b.score - a.score);
  const first = remaining.shift()!;
  selected.push({ ...first, mmrScore: first.score });

  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i]!;
      let maxSim = 0;
      for (const sel of selected) {
        const sim = cand.embedding && sel.embedding
          ? cosine(cand.embedding, sel.embedding)
          : cand.path === sel.path ? 0.5 : 0;
        if (sim > maxSim) maxSim = sim;
      }
      const mmr = lambda * cand.score - (1 - lambda) * maxSim;
      if (mmr > bestScore) { bestScore = mmr; bestIdx = i; }
    }
    const picked = remaining.splice(bestIdx, 1)[0]!;
    selected.push({ ...picked, mmrScore: bestScore });
  }
  return selected;
}
