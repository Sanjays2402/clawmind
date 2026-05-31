import { describe, it, expect } from 'vitest';
import { retrieveExplain } from '../src/explain.js';
import { BM25Index } from '@clawmind/store';
import type { Chunk, EmbedProvider, LLMProvider } from '@clawmind/types';

const mk = (id: string, text: string, ns = 'memory' as const): Chunk => ({
  id, documentId: id, path: `/${id}.md`, namespace: ns, text,
  startLine: 1, endLine: 1, tokens: 1, ord: 0, embedding: [0.1, 0.2],
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

describe('retrieveExplain', () => {
  it('returns per-chunk diagnostics with raw and normalised scores', async () => {
    const bm25 = new BM25Index();
    bm25.add([
      mk('a', 'snip launched today with a snip update'),
      mk('b', 'unrelated note about gardening'),
      mk('c', 'snip is mentioned briefly'),
    ]);
    const out = await retrieveExplain(
      { bm25, lance: fakeLance, embed: fakeEmbed, llm: fakeLlm, embedModel: 'f' },
      { q: 'snip', k: 3, mmrLambda: 0.5, hybridAlpha: 0.5 },
    );
    expect(out.candidates.length).toBeGreaterThan(0);
    const top = out.candidates[0]!;
    expect(top.bm25Raw).not.toBeNull();
    expect(top.bm25Norm).toBeGreaterThanOrEqual(0);
    expect(top.bm25Norm).toBeLessThanOrEqual(1);
    expect(top.hybridScore).toBeGreaterThanOrEqual(0);
    expect(out.funnel.bm25).toBeGreaterThan(0);
    expect(out.params.hybridAlpha).toBe(0.5);
    // at least one candidate should land in the final top-k
    expect(out.candidates.some((c) => c.inFinal)).toBe(true);
  });

  it('flags candidates filtered out of the final top-k', async () => {
    const bm25 = new BM25Index();
    bm25.add([
      mk('a', 'snip alpha'),
      mk('b', 'snip beta'),
      mk('c', 'snip gamma'),
      mk('d', 'snip delta'),
    ]);
    const out = await retrieveExplain(
      { bm25, lance: fakeLance, embed: fakeEmbed, llm: fakeLlm, embedModel: 'f' },
      { q: 'snip', k: 2, mmrLambda: 0.5, hybridAlpha: 0.5 },
    );
    const finals = out.candidates.filter((c) => c.inFinal);
    const dropped = out.candidates.filter((c) => !c.inFinal);
    expect(finals.length).toBe(2);
    expect(dropped.length).toBeGreaterThan(0);
    for (const f of finals) expect(f.finalRank).not.toBeNull();
    for (const d of dropped) expect(d.finalRank).toBeNull();
  });
});
