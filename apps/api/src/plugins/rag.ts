import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { RagDeps } from '@clawmind/rag';
import { AnswerCache } from '@clawmind/rag';
import { loadFeedback, boostFor, type FeedbackMap } from '../services/feedback.js';

declare module 'fastify' {
  interface FastifyInstance {
    rag: RagDeps;
    feedback: { reload(): Promise<void>; current(): FeedbackMap };
    answerCache: AnswerCache;
    corpusVersion: { value: number; bump(): number };
  }
}

const plugin: FastifyPluginAsync = async (app) => {
  const c = app.clawmind;
  let fb: FeedbackMap = await loadFeedback(c.dataDir);
  app.decorate('feedback', {
    reload: async () => { fb = await loadFeedback(c.dataDir); },
    current: () => fb,
  });
  app.decorate('rag', {
    bm25: c.bm25,
    lance: c.lance,
    embed: c.embed,
    llm: c.llm,
    embedModel: c.env.CLAWMIND_EMBED_MODEL,
    boost: (path: string) => boostFor(fb[path]),
  });
  app.decorate('answerCache', new AnswerCache({ maxEntries: 200, ttlMs: 30 * 60_000 }));
  const corpus = { value: Date.now(), bump(): number { corpus.value = Date.now(); return corpus.value; } };
  app.decorate('corpusVersion', corpus);
};

export const ragPlugin = fp(plugin, { name: 'rag' });
