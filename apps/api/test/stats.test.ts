import { describe, it, expect } from 'vitest';
import { computeStats } from '../src/services/stats.js';
import type { ManifestEntry } from '@clawmind/store';

function entry(overrides: Partial<ManifestEntry> & { path: string }): ManifestEntry {
  return {
    path: overrides.path,
    hash: overrides.hash ?? 'h',
    mtime: overrides.mtime ?? 0,
    size: overrides.size ?? 100,
    documentId: overrides.documentId ?? 'd',
    chunkCount: overrides.chunkCount ?? 1,
    ingestedAt: overrides.ingestedAt ?? 1_000,
  };
}

describe('computeStats', () => {
  it('returns zeros and empty list for an empty manifest', () => {
    const r = computeStats([]);
    expect(r.totals).toEqual({ files: 0, chunks: 0, bytes: 0, namespaces: 0 });
    expect(r.byNamespace).toEqual([]);
    expect(typeof r.generatedAt).toBe('number');
  });

  it('groups by inferred namespace and sums counts/bytes', () => {
    const entries: ManifestEntry[] = [
      entry({ path: '/ws/memory/2025-01-01.md', size: 200, chunkCount: 3, ingestedAt: 10 }),
      entry({ path: '/ws/memory/2025-01-02.md', size: 300, chunkCount: 4, ingestedAt: 20 }),
      entry({ path: '/ws/sessions/a.md', size: 500, chunkCount: 2, ingestedAt: 5 }),
      entry({ path: '/ws/docs/foo.md', size: 100, chunkCount: 1, ingestedAt: 7 }),
      entry({ path: '/ws/random/file.txt', size: 50, chunkCount: 1, ingestedAt: 1 }),
    ];
    const r = computeStats(entries);
    expect(r.totals.files).toBe(5);
    expect(r.totals.chunks).toBe(11);
    expect(r.totals.bytes).toBe(1150);
    expect(r.totals.namespaces).toBeGreaterThanOrEqual(3);

    const mem = r.byNamespace.find((n) => n.namespace === 'memory')!;
    expect(mem.files).toBe(2);
    expect(mem.chunks).toBe(7);
    expect(mem.bytes).toBe(500);
    expect(mem.oldestIngestedAt).toBe(10);
    expect(mem.newestIngestedAt).toBe(20);
  });

  it('sorts namespaces by chunk count descending', () => {
    const entries: ManifestEntry[] = [
      entry({ path: '/ws/docs/a.md', chunkCount: 1 }),
      entry({ path: '/ws/memory/a.md', chunkCount: 5 }),
      entry({ path: '/ws/memory/b.md', chunkCount: 5 }),
    ];
    const r = computeStats(entries);
    expect(r.byNamespace[0]!.namespace).toBe('memory');
  });

  it('extensions list is sorted by count and capped at 8', () => {
    const entries: ManifestEntry[] = [];
    for (let i = 0; i < 10; i++) {
      entries.push(entry({ path: `/ws/docs/a${i}.md`, chunkCount: 1 }));
    }
    for (let i = 0; i < 3; i++) {
      entries.push(entry({ path: `/ws/docs/b${i}.txt`, chunkCount: 1 }));
    }
    const r = computeStats(entries);
    const docs = r.byNamespace.find((n) => n.namespace === 'docs')!;
    expect(docs.extensions.length).toBeLessThanOrEqual(8);
    expect(docs.extensions[0]!.ext).toBe('.md');
    expect(docs.extensions[0]!.count).toBe(10);
  });
});
