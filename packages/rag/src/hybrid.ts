import type { RetrievedChunk } from '@clawmind/types';

// Normalize a score list to [0,1] via min-max so we can blend BM25 with cosine.
function minMax(scores: number[]): number[] {
  if (scores.length === 0) return [];
  let min = Infinity, max = -Infinity;
  for (const s of scores) { if (s < min) min = s; if (s > max) max = s; }
  if (max === min) return scores.map(() => (max > 0 ? 1 : 0));
  return scores.map((s) => (s - min) / (max - min));
}

export interface HybridOptions {
  alpha?: number; // weight on dense; (1 - alpha) on BM25
}

export function hybridMerge(
  bm25Hits: RetrievedChunk[],
  denseHits: RetrievedChunk[],
  opts: HybridOptions = {},
): RetrievedChunk[] {
  const alpha = opts.alpha ?? 0.5;
  const bm25Norm = minMax(bm25Hits.map((h) => h.bm25Score ?? h.score));
  const denseNorm = minMax(denseHits.map((h) => h.denseScore ?? h.score));
  const map = new Map<string, RetrievedChunk & { _bm: number; _de: number }>();

  bm25Hits.forEach((h, i) => {
    map.set(h.id, { ...h, _bm: bm25Norm[i] ?? 0, _de: 0 });
  });
  denseHits.forEach((h, i) => {
    const cur = map.get(h.id);
    if (cur) {
      cur._de = denseNorm[i] ?? 0;
      cur.denseScore = h.denseScore ?? h.score;
    } else {
      map.set(h.id, { ...h, _bm: 0, _de: denseNorm[i] ?? 0 });
    }
  });

  const merged = [...map.values()].map((h) => ({
    ...h,
    score: alpha * h._de + (1 - alpha) * h._bm,
  }));
  merged.sort((a, b) => b.score - a.score);
  return merged.map(({ _bm: _b, _de: _d, ...rest }) => rest);
}
