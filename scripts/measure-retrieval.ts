#!/usr/bin/env -S npx tsx
// Quick local sanity check: run a query and print top-k chunks with scores.
import { buildRuntime } from '../apps/cli/src/runtime.js';
import { retrieve } from '@clawmind/rag';
import { QuerySchema } from '@clawmind/types';

const q = process.argv.slice(2).join(' ') || 'what is clawmind?';
const rt = await buildRuntime();
const hits = await retrieve(
  { bm25: rt.bm25, lance: rt.lance, embed: rt.embed, llm: rt.llm, embedModel: rt.env.CLAWMIND_EMBED_MODEL },
  QuerySchema.parse({ q }),
);
for (const h of hits) {
  process.stdout.write(`${h.score.toFixed(3)}\t${h.path}:${h.startLine}\n`);
}
