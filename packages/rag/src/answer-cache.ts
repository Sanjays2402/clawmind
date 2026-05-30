import type { AskResult } from './pipeline.js';
import type { Query } from '@clawmind/types';

// Bounded in-memory LRU cache for `ask` results.
//
// The cache key is a stable hash of every input that can change the answer:
// normalized question text, namespace set, k, hybridAlpha, mmrLambda, expand
// flag, the model id, and a corpus version. Bump the corpus version on every
// ingest run so a fresh document invalidates stale answers without us having
// to reason about which keys matched which chunks.

export interface CacheEntry {
  result: AskResult;
  storedAt: number;
  hits: number;
}

export interface AnswerCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
}

const DEFAULT_MAX = 200;
const DEFAULT_TTL = 30 * 60_000; // 30 min

export function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function cacheKey(q: Query, modelId: string, corpusVersion: string | number): string {
  const ns = q.namespaces ? [...q.namespaces].sort().join(',') : '';
  return [
    normalizeQuestion(q.q),
    ns,
    `k=${q.k}`,
    `a=${q.hybridAlpha}`,
    `l=${q.mmrLambda}`,
    `e=${q.expand ? 1 : 0}`,
    `m=${modelId}`,
    `cv=${corpusVersion}`,
  ].join('|');
}

export class AnswerCache {
  private readonly map = new Map<string, CacheEntry>();
  private readonly max: number;
  private readonly ttl: number;
  private readonly now: () => number;
  private hitCount = 0;
  private missCount = 0;
  private evictCount = 0;

  constructor(opts: AnswerCacheOptions = {}) {
    this.max = opts.maxEntries ?? DEFAULT_MAX;
    this.ttl = opts.ttlMs ?? DEFAULT_TTL;
    this.now = opts.now ?? Date.now;
  }

  get(key: string): AskResult | null {
    const e = this.map.get(key);
    if (!e) { this.missCount++; return null; }
    if (this.ttl > 0 && this.now() - e.storedAt > this.ttl) {
      this.map.delete(key);
      this.missCount++;
      return null;
    }
    // LRU touch
    this.map.delete(key);
    this.map.set(key, e);
    e.hits++;
    this.hitCount++;
    return e.result;
  }

  set(key: string, result: AskResult) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { result, storedAt: this.now(), hits: 0 });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
      this.evictCount++;
    }
  }

  clear() {
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }

  stats() {
    return {
      size: this.map.size,
      max: this.max,
      hits: this.hitCount,
      misses: this.missCount,
      evictions: this.evictCount,
      hitRate: this.hitCount + this.missCount === 0
        ? 0
        : this.hitCount / (this.hitCount + this.missCount),
    };
  }
}
