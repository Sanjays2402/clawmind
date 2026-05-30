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
});
