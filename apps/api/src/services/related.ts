import type { Chunk, RetrievedChunk } from '@clawmind/types';

// "Related sources" computes a per-document query vector by averaging the
// embeddings of every chunk that belongs to a given path, then runs a
// vector search and folds the results back together so the response is
// one entry per neighbouring source (not per chunk). This is deliberately
// a separate code path from the ask/search pipeline because the input is
// a path rather than a natural-language query and the output is grouped
// at the document level.

export function averageEmbedding(chunks: Chunk[]): number[] | null {
  // Filter out the synthetic seed and any rows that somehow lack a vector.
  const withVec = chunks.filter((c) => Array.isArray(c.embedding) && c.embedding.length > 0);
  if (withVec.length === 0) return null;
  const dim = withVec[0]!.embedding!.length;
  const sum = new Array(dim).fill(0);
  let n = 0;
  for (const c of withVec) {
    const v = c.embedding!;
    if (v.length !== dim) continue; // skip dim mismatches defensively
    for (let i = 0; i < dim; i++) sum[i] += v[i]!;
    n++;
  }
  if (n === 0) return null;
  for (let i = 0; i < dim; i++) sum[i] /= n;
  return sum;
}

export interface RelatedItem {
  path: string;
  namespace: string;
  score: number;        // best chunk score across the document
  hits: number;         // how many chunks contributed
  bestChunkId: string;
  excerpt: string;      // first 240 chars of the best chunk text
}

/**
 * Group a flat list of retrieved chunks into one entry per source path,
 * excluding the originating path. Higher score wins per path, and ties
 * break on hit count.
 */
export function groupRelated(
  hits: RetrievedChunk[],
  excludePath: string,
  limit: number,
): RelatedItem[] {
  const byPath = new Map<string, RelatedItem>();
  for (const h of hits) {
    if (h.path === excludePath) continue;
    const cur = byPath.get(h.path);
    if (!cur) {
      byPath.set(h.path, {
        path: h.path,
        namespace: h.namespace,
        score: h.score,
        hits: 1,
        bestChunkId: h.id,
        excerpt: h.text.length > 240 ? h.text.slice(0, 240) + '...' : h.text,
      });
    } else {
      cur.hits += 1;
      if (h.score > cur.score) {
        cur.score = h.score;
        cur.bestChunkId = h.id;
        cur.excerpt = h.text.length > 240 ? h.text.slice(0, 240) + '...' : h.text;
      }
    }
  }
  return [...byPath.values()]
    .sort((a, b) => b.score - a.score || b.hits - a.hits)
    .slice(0, limit);
}
