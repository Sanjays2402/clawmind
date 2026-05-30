import type { EmbedProvider, LLMProvider, Query, RetrievedChunk, StreamEvent } from '@clawmind/types';
import { BM25Index, LanceStore } from '@clawmind/store';
import { buildPrompt } from '@clawmind/llm';
import { hybridMerge } from './hybrid.js';
import { mmrRerank } from './mmr.js';
import { lexicalRerank } from './rerank.js';
import { buildSources, extractCitations } from './citations.js';
import { toPromptContext } from './prompt-context.js';
import { expandQuery, vocabFromIndex, type Expansion } from './expand.js';

export interface RagDeps {
  bm25: BM25Index;
  lance: LanceStore;
  embed: EmbedProvider;
  llm: LLMProvider;
  embedModel: string;
  /** Optional path -> multiplier applied to blended scores before MMR. */
  boost?: (path: string) => number;
}

export interface RetrievalMeta {
  expansion: Expansion;
}

export async function retrieve(
  deps: RagDeps,
  q: Query,
  meta?: { meta: RetrievalMeta },
): Promise<RetrievedChunk[]> {
  const expansion = q.expand === false
    ? { original: q.q, expanded: q.q, added: [], corrections: [] }
    : expandQuery(q.q, { vocab: vocabFromIndex(deps.bm25) });
  if (meta) meta.meta = { expansion };
  const effectiveQ = expansion.expanded;
  const [emb] = (await deps.embed.embed({ texts: [effectiveQ], model: deps.embedModel })).vectors;
  const denseK = 40;
  const bm25K = 40;
  const [bm25Hits, denseHits] = await Promise.all([
    Promise.resolve(deps.bm25.search(effectiveQ, bm25K, q.namespaces)),
    deps.lance.search(emb ?? [], denseK, q.namespaces),
  ]);
  // attach query vector to candidates so MMR can do cosine
  for (const h of denseHits) if (!h.embedding) h.embedding = [];
  const merged = hybridMerge(bm25Hits, denseHits, { alpha: q.hybridAlpha });
  const boosted = deps.boost
    ? merged.map((h) => {
        const b = deps.boost!(h.path);
        return b === 1 ? h : { ...h, score: h.score * b };
      })
    : merged;
  const reranked = lexicalRerank(effectiveQ, boosted);
  const top = mmrRerank(reranked, { lambda: q.mmrLambda, k: q.k, queryVector: emb });
  return top;
}

export interface AskResult {
  text: string;
  sources: ReturnType<typeof buildSources>;
  citations: ReturnType<typeof extractCitations>;
  model: string;
  latencyMs: number;
  expansion?: Expansion;
}

export async function ask(deps: RagDeps, q: Query): Promise<AskResult> {
  const t0 = Date.now();
  const meta = { meta: { expansion: { original: q.q, expanded: q.q, added: [], corrections: [] } } };
  const hits = await retrieve(deps, q, meta);
  const sources = buildSources(hits);
  const context = toPromptContext(hits);
  const messages = buildPrompt({ question: q.q, context });
  const text = await deps.llm.chat({ model: '', messages, temperature: 0.2 });
  const citations = extractCitations(text, sources);
  return { text, sources, citations, model: deps.llm.id, latencyMs: Date.now() - t0, expansion: meta.meta.expansion };
}

export async function* askStream(deps: RagDeps, q: Query): AsyncIterable<StreamEvent> {
  const t0 = Date.now();
  const meta = { meta: { expansion: { original: q.q, expanded: q.q, added: [], corrections: [] } } };
  const hits = await retrieve(deps, q, meta);
  const sources = buildSources(hits);
  if (meta.meta.expansion.corrections.length || meta.meta.expansion.added.length) {
    yield { type: 'expansion', value: meta.meta.expansion } as StreamEvent;
  }
  yield { type: 'sources', value: sources };
  const context = toPromptContext(hits);
  const messages = buildPrompt({ question: q.q, context });
  let buffer = '';
  try {
    for await (const chunk of deps.llm.stream({ model: '', messages, temperature: 0.2 })) {
      if (chunk.delta) {
        buffer += chunk.delta;
        yield { type: 'token', value: chunk.delta };
      }
      if (chunk.done) break;
    }
  } catch (err) {
    yield { type: 'error', value: { message: (err as Error).message } };
    return;
  }
  const citations = extractCitations(buffer, sources);
  for (const c of citations) yield { type: 'citation', value: c };
  yield { type: 'done', value: { latencyMs: Date.now() - t0, model: deps.llm.id } };
}
