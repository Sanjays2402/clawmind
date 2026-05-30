import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { RagDeps } from '@clawmind/rag';
import { AnswerCache } from '@clawmind/rag';
import { loadFeedback, boostFor, type FeedbackMap } from '../services/feedback.js';
import { loadPins, pinBoostFor, type PinMap } from '../services/pins.js';
import { loadMutes, mutePenaltyFor, type MuteMap } from '../services/mutes.js';
import {
  loadAliases, expandQueryAliases, shortenPath, type AliasMap,
} from '../services/aliases.js';
import { loadTags, buildTagFilter, type TagMap } from '../services/tags.js';

declare module 'fastify' {
  interface FastifyInstance {
    rag: RagDeps;
    feedback: { reload(): Promise<void>; current(): FeedbackMap };
    pins: { reload(): Promise<void>; current(): PinMap };
    mutes: { reload(): Promise<void>; current(): MuteMap };
    aliases: {
      reload(): Promise<void>;
      current(): AliasMap;
      expandQuery(q: string): string;
      shorten(path: string): string | null;
    };
    tags: { reload(): Promise<void>; current(): TagMap };
    answerCache: AnswerCache;
    corpusVersion: { value: number; bump(): number };
  }
}

const plugin: FastifyPluginAsync = async (app) => {
  const c = app.clawmind;
  let fb: FeedbackMap = await loadFeedback(c.dataDir);
  let pins: PinMap = await loadPins(c.dataDir);
  let mutes: MuteMap = await loadMutes(c.dataDir);
  let aliases: AliasMap = await loadAliases(c.dataDir);
  let tags: TagMap = await loadTags(c.dataDir);
  app.decorate('feedback', {
    reload: async () => { fb = await loadFeedback(c.dataDir); },
    current: () => fb,
  });
  app.decorate('pins', {
    reload: async () => { pins = await loadPins(c.dataDir); },
    current: () => pins,
  });
  app.decorate('mutes', {
    reload: async () => { mutes = await loadMutes(c.dataDir); },
    current: () => mutes,
  });
  app.decorate('aliases', {
    reload: async () => { aliases = await loadAliases(c.dataDir); },
    current: () => aliases,
    expandQuery: (q: string) => expandQueryAliases(aliases, q),
    shorten: (path: string) => shortenPath(aliases, path),
  });
  app.decorate('tags', {
    reload: async () => { tags = await loadTags(c.dataDir); },
    current: () => tags,
  });
  const filterCache = new WeakMap<object, ((p: string) => boolean) | null>();
  app.decorate('rag', {
    bm25: c.bm25,
    lance: c.lance,
    embed: c.embed,
    llm: c.llm,
    embedModel: c.env.CLAWMIND_EMBED_MODEL,
    boost: (path: string) =>
      boostFor(fb[path]) * pinBoostFor(pins, path) * mutePenaltyFor(mutes, path),
    pathFilter: (q, path) => {
      let pred = filterCache.get(q);
      if (pred === undefined) {
        pred = buildTagFilter(tags, {
          includeTags: q.includeTags,
          excludeTags: q.excludeTags,
        });
        filterCache.set(q, pred);
      }
      return pred ? pred(path) : true;
    },
  });
  app.decorate('answerCache', new AnswerCache({ maxEntries: 200, ttlMs: 30 * 60_000 }));
  const corpus = { value: Date.now(), bump(): number { corpus.value = Date.now(); return corpus.value; } };
  app.decorate('corpusVersion', corpus);
};

export const ragPlugin = fp(plugin, { name: 'rag' });
