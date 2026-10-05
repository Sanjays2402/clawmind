import type { RetrievedChunk } from '@clawmind/types';

// Normalize a score list to [0,1] by dividing by the max so BM25 and cosine
// can be blended. Min-max was used previously, but it pins the weakest hit in
// each list to 0, so a chunk ranked by both retrievers could score no better
// than one ranked by only one of them. Negative scores clamp to 0.
export function normalizeScores(scores: number[]): number[] {
  if (scores.length === 0) return [];
  let max = 0;
  for (const s of scores) if (s > max) max = s;
  if (max <= 0) return scores.map(() => 0);
  return scores.map((s) => Math.max(0, s) / max);
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
  const bm25Norm = normalizeScores(bm25Hits.map((h) => h.bm25Score ?? h.score));
  const denseNorm = normalizeScores(denseHits.map((h) => h.denseScore ?? h.score));
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
