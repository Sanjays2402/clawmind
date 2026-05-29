import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { RagDeps } from '@clawmind/rag';

declare module 'fastify' {
  interface FastifyInstance {
    rag: RagDeps;
  }
}

const plugin: FastifyPluginAsync = async (app) => {
  const c = app.clawmind;
  app.decorate('rag', {
    bm25: c.bm25,
    lance: c.lance,
    embed: c.embed,
    llm: c.llm,
    embedModel: c.env.CLAWMIND_EMBED_MODEL,
  });
};

export const ragPlugin = fp(plugin, { name: 'rag' });
