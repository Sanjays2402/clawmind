import type { Query, RetrievedChunk } from '@clawmind/types';
import type { RagDeps } from './pipeline.js';
import { mmrRerank } from './mmr.js';
import { lexicalRerank } from './rerank.js';
import { expandQuery, vocabFromIndex } from './expand.js';

// Per-chunk diagnostic record returned by `retrieveExplain`. Each field
// captures one stage of the hybrid pipeline so the UI can show which
// signal pulled the chunk into the top-k.
export interface ChunkExplanation {
  id: string;
  path: string;
  displayPath?: string;
  namespace: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  // Raw upstream scores. BM25 is the lexical TF-IDF score; dense is cosine
  // similarity from LanceDB. Either may be missing if only one retriever
  // found the chunk.
  bm25Raw: number | null;
  denseRaw: number | null;
  // Min-max normalised values used by the hybrid merge so they are
  // directly comparable.
  bm25Norm: number;
  denseNorm: number;
  // alpha * denseNorm + (1-alpha) * bm25Norm, before lexical rerank.
  hybridScore: number;
  // Score after lexicalRerank (token-overlap bonus on top of hybrid).
  rerankedScore: number;
  // MMR-adjusted score for chunks that made it into the diversified top-k.
  mmrScore: number | null;
  // 1-based MMR rank in the final answer, or null if filtered out.
  finalRank: number | null;
  inFinal: boolean;
}

export interface RetrieveExplainResult {
  query: {
    original: string;
    expanded: string;
    added: string[];
    corrections: Array<{ from: string; to: string }>;
  };
  params: { hybridAlpha: number; mmrLambda: number; k: number };
  candidates: ChunkExplanation[];
  // counts at each pipeline stage so the UI can show funnel numbers.
  funnel: {
    bm25: number;
    dense: number;
    merged: number;
    afterFilter: number;
    afterRerank: number;
    final: number;
  };
}

function minMax(scores: number[]): number[] {
  if (scores.length === 0) return [];
  let min = Infinity, max = -Infinity;
  for (const s of scores) { if (s < min) min = s; if (s > max) max = s; }
  if (max === min) return scores.map(() => (max > 0 ? 1 : 0));
  return scores.map((s) => (s - min) / (max - min));
}

function excerptOf(text: string, n = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= n ? flat : flat.slice(0, n - 1) + '…';
}

// Run the same retrieval as `retrieve()` but keep every intermediate score
// so the UI can explain why a chunk ended up where it did. This is a
// debugging / transparency endpoint; it does not call the LLM.
export async function retrieveExplain(
  deps: RagDeps,
  q: Query,
): Promise<RetrieveExplainResult> {
  const expansion = q.expand === false
    ? { original: q.q, expanded: q.q, added: [], corrections: [] }
    : expandQuery(q.q, { vocab: vocabFromIndex(deps.bm25) });
  const effectiveQ = expansion.expanded;
  const [emb] = (await deps.embed.embed({ texts: [effectiveQ], model: deps.embedModel })).vectors;
  const denseK = 40;
  const bm25K = 40;
  const [bm25Hits, denseHits] = await Promise.all([
    Promise.resolve(deps.bm25.search(effectiveQ, bm25K, q.namespaces)),
    deps.lance.search(emb ?? [], denseK, q.namespaces),
  ]);

  const alpha = q.hybridAlpha ?? 0.5;
  const bm25Norm = minMax(bm25Hits.map((h) => h.bm25Score ?? h.score));
  const denseNorm = minMax(denseHits.map((h) => h.denseScore ?? h.score));

  const map = new Map<string, {
    chunk: RetrievedChunk;
    bm25Raw: number | null;
    denseRaw: number | null;
    bm25Norm: number;
    denseNorm: number;
  }>();
  bm25Hits.forEach((h, i) => {
    map.set(h.id, {
      chunk: h,
      bm25Raw: h.bm25Score ?? h.score,
      denseRaw: null,
      bm25Norm: bm25Norm[i] ?? 0,
      denseNorm: 0,
    });
  });
  denseHits.forEach((h, i) => {
    const cur = map.get(h.id);
    if (cur) {
      cur.denseRaw = h.denseScore ?? h.score;
      cur.denseNorm = denseNorm[i] ?? 0;
    } else {
      map.set(h.id, {
        chunk: h,
        bm25Raw: null,
        denseRaw: h.denseScore ?? h.score,
        bm25Norm: 0,
        denseNorm: denseNorm[i] ?? 0,
      });
    }
  });

  const merged = [...map.values()];
  const filtered = deps.pathFilter
    ? merged.filter((m) => deps.pathFilter!(q, m.chunk.path))
    : merged;

  // Apply hybrid + optional boost the same way pipeline.ts does so the
  // explained order matches what /v1/ask saw.
  const blended: RetrievedChunk[] = filtered.map((m) => {
    const boost = deps.boost ? deps.boost(m.chunk.path) : 1;
    const hybrid = (alpha * m.denseNorm + (1 - alpha) * m.bm25Norm) * boost;
    return { ...m.chunk, score: hybrid };
  });
  const reranked = lexicalRerank(effectiveQ, blended);
  const k = q.k ?? 8;
  const mmrLambda = q.mmrLambda ?? 0.5;
  const finalTop = mmrRerank(reranked, { lambda: mmrLambda, k, queryVector: emb });

  const rerankById = new Map(reranked.map((h) => [h.id, h.score]));
  const finalById = new Map(finalTop.map((h, i) => [h.id, { rank: i + 1, score: h.mmrScore ?? h.score }]));

  const candidates: ChunkExplanation[] = filtered.map((m) => {
    const hybrid = alpha * m.denseNorm + (1 - alpha) * m.bm25Norm;
    const finalEntry = finalById.get(m.chunk.id);
    return {
      id: m.chunk.id,
      path: m.chunk.path,
      namespace: m.chunk.namespace,
      startLine: m.chunk.startLine,
      endLine: m.chunk.endLine,
      excerpt: excerptOf(m.chunk.text),
      bm25Raw: m.bm25Raw,
      denseRaw: m.denseRaw,
      bm25Norm: m.bm25Norm,
      denseNorm: m.denseNorm,
      hybridScore: hybrid,
      rerankedScore: rerankById.get(m.chunk.id) ?? hybrid,
      mmrScore: finalEntry?.score ?? null,
      finalRank: finalEntry?.rank ?? null,
      inFinal: !!finalEntry,
    };
  });
  // Sort by rerankedScore desc so the UI gets a sensible default order.
  candidates.sort((a, b) => b.rerankedScore - a.rerankedScore);

  return {
    query: expansion,
    params: { hybridAlpha: alpha, mmrLambda, k },
    candidates,
    funnel: {
      bm25: bm25Hits.length,
      dense: denseHits.length,
      merged: merged.length,
      afterFilter: filtered.length,
      afterRerank: reranked.length,
      final: finalTop.length,
    },
  };
}
