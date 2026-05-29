import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Chunk, RetrievedChunk } from '@clawmind/types';

// Compact pure-TS BM25 index. Persisted as JSON. Good enough for hundreds of
// thousands of chunks; if it ever stops being good enough, swap for tantivy.
export interface BM25Options {
  k1?: number;
  b?: number;
}

interface DocEntry {
  id: string;
  chunk: Chunk;
  len: number;
  tf: Record<string, number>;
}

const STOP = new Set([
  'a','an','the','and','or','but','if','then','else','for','of','to','in','on','at','by','is','are','was','were','be','been','being','it','its','as','this','that','with','from','i','you','we','they','he','she','them','me','my','your','our','their','do','does','did','have','has','had','will','would','can','could','should','about','into','over','under','out','up','down','so','not','no'
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[`*_~>#\[\]()<>!?,.;:"'+=\\/|{}-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && t.length <= 40 && !STOP.has(t));
}

export class BM25Index {
  private docs: DocEntry[] = [];
  private df: Map<string, number> = new Map();
  private avgLen = 0;
  private readonly k1: number;
  private readonly b: number;

  constructor(opts: BM25Options = {}) {
    this.k1 = opts.k1 ?? 1.2;
    this.b = opts.b ?? 0.75;
  }

  add(chunks: Chunk[]) {
    for (const c of chunks) {
      const tokens = tokenize(c.text);
      const tf: Record<string, number> = {};
      for (const t of tokens) tf[t] = (tf[t] ?? 0) + 1;
      this.docs.push({ id: c.id, chunk: c, len: tokens.length, tf });
      const seen = new Set(Object.keys(tf));
      for (const t of seen) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.recomputeAvg();
  }

  removeByDocumentId(documentId: string) {
    const keep: DocEntry[] = [];
    for (const d of this.docs) {
      if (d.chunk.documentId === documentId) {
        for (const t of Object.keys(d.tf)) {
          const v = (this.df.get(t) ?? 1) - 1;
          if (v <= 0) this.df.delete(t);
          else this.df.set(t, v);
        }
      } else keep.push(d);
    }
    this.docs = keep;
    this.recomputeAvg();
  }

  size() { return this.docs.length; }

  private recomputeAvg() {
    this.avgLen = this.docs.length ? this.docs.reduce((s, d) => s + d.len, 0) / this.docs.length : 0;
  }

  search(query: string, k: number, namespaces?: string[]): RetrievedChunk[] {
    const qTokens = [...new Set(tokenize(query))];
    if (qTokens.length === 0 || this.docs.length === 0) return [];
    const N = this.docs.length;
    const scored: { d: DocEntry; score: number }[] = [];
    for (const d of this.docs) {
      if (namespaces && !namespaces.includes(d.chunk.namespace)) continue;
      let score = 0;
      for (const t of qTokens) {
        const tf = d.tf[t];
        if (!tf) continue;
        const df = this.df.get(t) ?? 1;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const denom = tf + this.k1 * (1 - this.b + this.b * (d.len / (this.avgLen || 1)));
        score += idf * ((tf * (this.k1 + 1)) / denom);
      }
      if (score > 0) scored.push({ d, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map(({ d, score }) => ({ ...d.chunk, score, bm25Score: score }));
  }

  async save(file: string) {
    await mkdir(dirname(file), { recursive: true });
    const payload = {
      version: 1,
      k1: this.k1,
      b: this.b,
      docs: this.docs.map((d) => ({ id: d.id, chunk: d.chunk, len: d.len, tf: d.tf })),
    };
    await writeFile(file, JSON.stringify(payload), 'utf8');
  }

  static async load(file: string, opts?: BM25Options): Promise<BM25Index> {
    const idx = new BM25Index(opts);
    try {
      const raw = await readFile(file, 'utf8');
      const data = JSON.parse(raw) as { docs: DocEntry[] };
      idx.docs = data.docs;
      idx.df = new Map();
      for (const d of idx.docs) {
        for (const t of Object.keys(d.tf)) idx.df.set(t, (idx.df.get(t) ?? 0) + 1);
      }
      idx.recomputeAvg();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return idx;
  }
}
