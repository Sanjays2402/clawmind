import { describe, it, expect } from 'vitest';
import { retrieve } from '../src/pipeline.js';
import { BM25Index } from '@clawmind/store';
import type { Chunk, EmbedProvider, LLMProvider } from '@clawmind/types';

const mk = (id: string, text: string, ns = 'memory' as const): Chunk => ({
  id, documentId: id, path: `/${id}.md`, namespace: ns, text,
  startLine: 1, endLine: 1, tokens: 1, ord: 0, embedding: [Math.random(), Math.random()],
});

const fakeEmbed: EmbedProvider = {
  id: 'fake', dim: () => 2, async health() { return true; },
  async embed({ texts }) { return { vectors: texts.map(() => [0.1, 0.2]), model: 'f', dim: 2 }; },
};

const fakeLlm: LLMProvider = {
  id: 'fake', async health() { return true; },
  async chat() { return ''; }, async *stream() { yield { delta: '', done: true }; },
};

const fakeLance = {
  search: async () => [] as Chunk[],
} as unknown as import('@clawmind/store').LanceStore;

describe('retrieve', () => {
  it('returns BM25 hits even with empty lance', async () => {
    const bm25 = new BM25Index();
    bm25.add([mk('a', 'snip launched today'), mk('b', 'unrelated note')]);
    const hits = await retrieve(
      { bm25, lance: fakeLance, embed: fakeEmbed, llm: fakeLlm, embedModel: 'f' },
      { q: 'snip', k: 5, mmrLambda: 0.5, hybridAlpha: 0.5 },
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.id).toBe('a');
  });

  it('honours pathFilter to drop hits before reranking', async () => {
    const bm25 = new BM25Index();
    bm25.add([
      mk('a', 'snip launched today'),
      mk('b', 'snip also mentioned here'),
    ]);
    const hits = await retrieve(
      {
        bm25, lance: fakeLance, embed: fakeEmbed, llm: fakeLlm, embedModel: 'f',
        pathFilter: (_q, path) => path !== '/a.md',
      },
      { q: 'snip', k: 5, mmrLambda: 0.5, hybridAlpha: 0.5 },
    );
    expect(hits.map((h) => h.id)).toEqual(['b']);
  });

  // ---------------------------------------------------------------
  // skipRerank: DEBUG escape hatch wired through RetrieveOptions.
  // The lexical-rerank stage applies a heuristic boost on top of the
  // hybrid-merged + boost-adjusted ordering (compact-passage penalty,
  // exact-term occurrences). When `skipRerank: true` is set, that
  // stage is bypassed entirely — the pipeline forwards the raw
  // `boosted` ordering directly to MMR. The operator uses this via
  // `clawmind search --rerank-off` to diagnose whether the rerank
  // is HELPING or HURTING on a particular query.
  // ---------------------------------------------------------------

  it('skipRerank bypasses the lexical-rerank stage (raw scores survive into the output)', async () => {
    // The lexical-rerank stage applies a per-hit bonus (count of
    // exact-term occurrences * 0.02) minus a small length penalty.
    // The bonus is computed on the hit's `text`, so a chunk that
    // contains MANY exact-term matches will see its score bumped
    // upward when rerank is ON, and left at the hybrid-merged value
    // when rerank is OFF. We assert the SCORE DIFFERENCE rather than
    // the ordering — the ordering also depends on MMR's diversity
    // tradeoff and the embeddings, neither of which we want to bake
    // into the assertion. The score-delta is the cleanest signal
    // that "the rerank stage actually ran" or "the rerank stage was
    // skipped".
    const repeat = ('snip ' as string).repeat(20);
    const bm25 = new BM25Index();
    bm25.add([
      mk('a', `${repeat}rest of the text`), // 20 occurrences -> big rerank bonus
    ]);
    const baseDeps = { bm25, lance: fakeLance, embed: fakeEmbed, llm: fakeLlm, embedModel: 'f' };
    const reranked = await retrieve(baseDeps, { q: 'snip', k: 5, mmrLambda: 0.5, hybridAlpha: 0.5 });
    const raw = await retrieve(
      baseDeps,
      { q: 'snip', k: 5, mmrLambda: 0.5, hybridAlpha: 0.5 },
      undefined,
      { skipRerank: true },
    );
    // Both return the same chunk (only one indexed); the score
    // difference is what proves the rerank stage was bypassed.
    expect(reranked.length).toBe(1);
    expect(raw.length).toBe(1);
    expect(reranked[0]!.id).toBe('a');
    expect(raw[0]!.id).toBe('a');
    // The reranked score must be STRICTLY greater than the raw
    // score because the 20 exact-term occurrences give a bonus of
    // 20 * 0.02 = 0.40 minus a tiny length penalty (text is well
    // under the 1500-char penalty cap so the deduction is zero).
    // If skipRerank was a no-op, both scores would match — the
    // assertion would fail.
    expect(reranked[0]!.score).toBeGreaterThan(raw[0]!.score);
    expect(reranked[0]!.score - raw[0]!.score).toBeGreaterThan(0.3);
  });

  it('skipRerank=false (omitted) keeps the rerank ON (regression: default unchanged)', async () => {
    // Critical: passing the new options arg as undefined / omitted
    // must behave EXACTLY as before. Otherwise every existing
    // caller in the codebase would silently lose the rerank stage.
    const bm25 = new BM25Index();
    bm25.add([mk('a', 'snip launched today'), mk('b', 'unrelated note')]);
    const baseDeps = { bm25, lance: fakeLance, embed: fakeEmbed, llm: fakeLlm, embedModel: 'f' };
    const legacy = await retrieve(baseDeps, { q: 'snip', k: 5, mmrLambda: 0.5, hybridAlpha: 0.5 });
    const explicitFalse = await retrieve(
      baseDeps,
      { q: 'snip', k: 5, mmrLambda: 0.5, hybridAlpha: 0.5 },
      undefined,
      { skipRerank: false },
    );
    // Same input + same flag-off path -> identical top hit and order.
    expect(legacy[0]?.id).toBe(explicitFalse[0]?.id);
    expect(legacy.map((h) => h.id)).toEqual(explicitFalse.map((h) => h.id));
    // And identical scores (the rerank stage ran in both).
    expect(legacy[0]!.score).toBe(explicitFalse[0]!.score);
  });

  // ---------------------------------------------------------------
  // skipMmr: DEBUG escape hatch wired through RetrieveOptions.
  // The MMR stage re-orders the rerank output to balance relevance
  // with cross-document diversity. When `skipMmr: true` is set, the
  // pipeline forwards the rerank score order directly to the caller
  // (sliced to q.k). The operator uses this via `clawmind search
  // --rerank-only` to see what the rerank stage ALONE thinks is the
  // most relevant set, before MMR smears the order with diversity.
  // ---------------------------------------------------------------

  it('skipMmr bypasses the MMR diversity pass (returns rerank score order)', async () => {
    // Build a corpus where MMR would clearly reshape the order: three
    // chunks from the same document compete with one chunk from a
    // different document for the top-3 slot. With MMR ON, the
    // diversity penalty demotes the same-document siblings even
    // though they score higher in the rerank stage. With MMR OFF
    // (skipMmr=true), the rerank-score order survives intact: the
    // top three are the three same-document chunks because their
    // rerank scores are higher.
    const bm25 = new BM25Index();
    // Three "snip" chunks from doc /high.md: same path => MMR penalises diversity
    bm25.add([
      { id: 'h1', documentId: 'high', path: '/high.md', namespace: 'memory',
        text: 'snip snip snip snip snip first chunk', startLine: 1, endLine: 1,
        tokens: 1, ord: 0, embedding: [0.9, 0.1] },
      { id: 'h2', documentId: 'high', path: '/high.md', namespace: 'memory',
        text: 'snip snip snip snip snip second chunk', startLine: 1, endLine: 1,
        tokens: 1, ord: 1, embedding: [0.9, 0.1] },
      { id: 'h3', documentId: 'high', path: '/high.md', namespace: 'memory',
        text: 'snip snip snip snip snip third chunk', startLine: 1, endLine: 1,
        tokens: 1, ord: 2, embedding: [0.9, 0.1] },
      // One "snip" chunk from a different path that MMR would promote.
      { id: 'o', documentId: 'other', path: '/other.md', namespace: 'memory',
        text: 'snip mention here', startLine: 1, endLine: 1,
        tokens: 1, ord: 0, embedding: [0.1, 0.9] },
    ]);
    const baseDeps = { bm25, lance: fakeLance, embed: fakeEmbed, llm: fakeLlm, embedModel: 'f' };
    const withMmr = await retrieve(baseDeps, { q: 'snip', k: 3, mmrLambda: 0.3, hybridAlpha: 0.5 });
    const withoutMmr = await retrieve(
      baseDeps,
      { q: 'snip', k: 3, mmrLambda: 0.3, hybridAlpha: 0.5 },
      undefined,
      { skipMmr: true },
    );
    // Both return exactly k=3 items (skipMmr still honours q.k).
    expect(withMmr.length).toBe(3);
    expect(withoutMmr.length).toBe(3);
    // With MMR off, the rerank-score order survives — the three
    // same-document chunks (h1/h2/h3) dominate by rerank score
    // because they each carry 5 exact-term occurrences => big
    // bonus relative to the single-occurrence "/other.md" chunk.
    // We assert the rerank-only output contains all three same-doc
    // chunks (in any order — rerank is score-driven, ties may
    // shuffle) and crucially DOES NOT include "/other.md" (which
    // MMR would have promoted for diversity).
    const skipMmrPaths = new Set(withoutMmr.map((h) => h.path));
    expect(skipMmrPaths.size).toBe(1); // all from /high.md
    expect(skipMmrPaths.has('/high.md')).toBe(true);
    expect(skipMmrPaths.has('/other.md')).toBe(false);
    // The MMR-on path SHOULD include /other.md (diversity reorder)
    // — that's the contrast that proves the bypass is doing work.
    const withMmrPaths = new Set(withMmr.map((h) => h.path));
    expect(withMmrPaths.has('/other.md')).toBe(true);
  });

  it('skipMmr=false (omitted) keeps the MMR pass ON (regression: default unchanged)', async () => {
    // Mirror of the skipRerank regression test: passing the new
    // options arg as undefined / omitted must behave EXACTLY as
    // before so every existing caller stays byte-identical.
    const bm25 = new BM25Index();
    bm25.add([mk('a', 'snip launched today'), mk('b', 'unrelated note')]);
    const baseDeps = { bm25, lance: fakeLance, embed: fakeEmbed, llm: fakeLlm, embedModel: 'f' };
    const legacy = await retrieve(baseDeps, { q: 'snip', k: 5, mmrLambda: 0.5, hybridAlpha: 0.5 });
    const explicitFalse = await retrieve(
      baseDeps,
      { q: 'snip', k: 5, mmrLambda: 0.5, hybridAlpha: 0.5 },
      undefined,
      { skipMmr: false },
    );
    expect(legacy.map((h) => h.id)).toEqual(explicitFalse.map((h) => h.id));
    expect(legacy[0]!.score).toBe(explicitFalse[0]!.score);
  });

  it('skipMmr honours q.k by slicing the rerank output (no overshoot)', async () => {
    // The bypass walks rerank->slice(0, k) directly, NOT mmrRerank.
    // We must not return more than k items just because the rerank
    // stage produced more candidates.
    const bm25 = new BM25Index();
    bm25.add([
      mk('a', 'snip one'),
      mk('b', 'snip two'),
      mk('c', 'snip three'),
      mk('d', 'snip four'),
      mk('e', 'snip five'),
    ]);
    const baseDeps = { bm25, lance: fakeLance, embed: fakeEmbed, llm: fakeLlm, embedModel: 'f' };
    const hits = await retrieve(
      baseDeps,
      { q: 'snip', k: 2, mmrLambda: 0.5, hybridAlpha: 0.5 },
      undefined,
      { skipMmr: true },
    );
    expect(hits.length).toBe(2);
  });

  it('skipRerank + skipMmr together returns the raw hybrid+boost ordering (sliced to k)', async () => {
    // The most extreme bypass: both stages off. The pipeline returns
    // the head N of the hybrid-merged + boost-adjusted ordering with
    // NEITHER the rerank bonus NOR the diversity pass applied. Used
    // when an operator sets both --rerank-off AND --rerank-only on
    // the cli for a "what does the index look like before any
    // heuristic touches it" probe.
    const bm25 = new BM25Index();
    bm25.add([mk('a', 'snip one'), mk('b', 'snip two'), mk('c', 'snip three')]);
    const baseDeps = { bm25, lance: fakeLance, embed: fakeEmbed, llm: fakeLlm, embedModel: 'f' };
    const both = await retrieve(
      baseDeps,
      { q: 'snip', k: 2, mmrLambda: 0.5, hybridAlpha: 0.5 },
      undefined,
      { skipRerank: true, skipMmr: true },
    );
    // The slice honours q.k; we can't assert the order without
    // baking the hybrid alpha behaviour in, but k must be enforced.
    expect(both.length).toBe(2);
  });
});
