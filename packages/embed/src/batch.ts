import type { EmbedProvider } from '@clawmind/types';
import { EmbedCache } from './cache.js';

export interface BatchOpts {
  batchSize?: number;
  cache?: EmbedCache;
  model: string;
}

export async function embedAll(provider: EmbedProvider, texts: string[], opts: BatchOpts): Promise<number[][]> {
  const batchSize = opts.batchSize ?? 64;
  const out: number[][] = new Array(texts.length);
  const queue: { idx: number; text: string }[] = [];
  for (let i = 0; i < texts.length; i++) {
    const cached = opts.cache?.get(texts[i]!, opts.model);
    if (cached) out[i] = cached;
    else queue.push({ idx: i, text: texts[i]! });
  }
  for (let i = 0; i < queue.length; i += batchSize) {
    const slice = queue.slice(i, i + batchSize);
    const res = await provider.embed({ texts: slice.map((s) => s.text), model: opts.model });
    res.vectors.forEach((v, j) => {
      const target = slice[j]!;
      out[target.idx] = v;
      opts.cache?.set(target.text, opts.model, v);
    });
  }
  return out;
}
