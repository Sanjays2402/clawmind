#!/usr/bin/env -S npx tsx
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildRuntime } from '../apps/cli/src/runtime.js';
import { retrieve } from '@clawmind/rag';
import { QuerySchema } from '@clawmind/types';

const rt = await buildRuntime();
const exp = await readdir('eval/expected');
const results: unknown[] = [];
for (const f of exp) {
  const spec = JSON.parse(await readFile(join('eval/expected', f), 'utf8')) as { id: string; query: string; must_contain: string[] };
  const hits = await retrieve(
    { bm25: rt.bm25, lance: rt.lance, embed: rt.embed, llm: rt.llm, embedModel: rt.env.CLAWMIND_EMBED_MODEL },
    QuerySchema.parse({ q: spec.query, k: 8 }),
  );
  const text = hits.map((h) => h.text.toLowerCase()).join(' ');
  const hit = spec.must_contain.every((t) => text.includes(t.toLowerCase()));
  results.push({ id: spec.id, query: spec.query, pass: hit, top: hits.slice(0, 3).map((h) => h.path) });
}
await mkdir('eval/reports', { recursive: true });
const file = `eval/reports/report-${Date.now()}.json`;
await writeFile(file, JSON.stringify(results, null, 2));
process.stdout.write(`wrote ${file}\n`);
