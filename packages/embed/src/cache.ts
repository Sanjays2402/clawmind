import { createHash } from 'node:crypto';

export class EmbedCache {
  private store = new Map<string, number[]>();
  constructor(private readonly maxEntries = 50_000) {}

  private key(text: string, model: string) {
    return createHash('sha1').update(`${model}::${text}`).digest('hex');
  }

  get(text: string, model: string) {
    return this.store.get(this.key(text, model));
  }

  set(text: string, model: string, vec: number[]) {
    if (this.store.size >= this.maxEntries) {
      const first = this.store.keys().next().value;
      if (first) this.store.delete(first);
    }
    this.store.set(this.key(text, model), vec);
  }

  size() { return this.store.size; }
  clear() { this.store.clear(); }
}
