import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compactStore } from '../src/compact.js';
import { BM25Index, IngestManifest } from '@clawmind/store';
import type { Chunk } from '@clawmind/types';

class FakeLance {
  deleted: string[] = [];
  async deleteByDocument(id: string) { this.deleted.push(id); }
}

function chunk(id: string, documentId: string, path: string): Chunk {
  return {
    id, documentId, path, namespace: 'docs',
    text: `text for ${id}`, startLine: 0, endLine: 1, tokens: 4, ord: 0,
  } as Chunk;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-compact-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('compactStore', () => {
  it('removes manifest, bm25, and lance entries for missing files', async () => {
    const present = join(dir, 'kept.md');
    const missing = join(dir, 'gone.md');
    writeFileSync(present, '# hi');

    const manifest = new IngestManifest(join(dir, 'manifest.json'));
    await manifest.load();
    manifest.set({ path: present, hash: 'h1', mtime: 1, size: 4, documentId: 'doc-keep', chunkCount: 1, ingestedAt: 0 });
    manifest.set({ path: missing, hash: 'h2', mtime: 1, size: 4, documentId: 'doc-gone', chunkCount: 1, ingestedAt: 0 });

    const bm25 = new BM25Index();
    bm25.add([chunk('c1', 'doc-keep', present), chunk('c2', 'doc-gone', missing)]);
    const bm25File = join(dir, 'bm25.json');
    const lance = new FakeLance();

    const report = await compactStore({
      manifest, bm25, bm25File, lance: lance as never,
    });

    expect(report.scanned).toBe(2);
    expect(report.removed).toBe(1);
    expect(report.kept).toBe(1);
    expect(report.removedPaths).toEqual([missing]);
    expect(report.dryRun).toBe(false);
    expect(lance.deleted).toEqual(['doc-gone']);
    expect(manifest.get(present)).toBeDefined();
    expect(manifest.get(missing)).toBeUndefined();
    expect(bm25.size()).toBe(1);
  });

  it('does nothing in dry-run mode but still reports', async () => {
    const present = join(dir, 'a.md');
    writeFileSync(present, '# a');
    const manifest = new IngestManifest(join(dir, 'manifest.json'));
    await manifest.load();
    manifest.set({ path: present, hash: 'h', mtime: 1, size: 3, documentId: 'doc-a', chunkCount: 1, ingestedAt: 0 });
    manifest.set({ path: join(dir, 'ghost.md'), hash: 'h', mtime: 1, size: 0, documentId: 'doc-ghost', chunkCount: 0, ingestedAt: 0 });

    const bm25 = new BM25Index();
    bm25.add([chunk('c1', 'doc-a', present)]);
    const lance = new FakeLance();

    const report = await compactStore({
      manifest, bm25, bm25File: join(dir, 'bm25.json'),
      lance: lance as never, dryRun: true,
    });

    expect(report.dryRun).toBe(true);
    expect(report.removed).toBe(1);
    expect(lance.deleted).toEqual([]);
    expect(manifest.size()).toBe(2);
  });

  it('reports zero removals when everything is intact', async () => {
    const a = join(dir, 'a.md'); writeFileSync(a, '#');
    const manifest = new IngestManifest(join(dir, 'manifest.json'));
    await manifest.load();
    manifest.set({ path: a, hash: 'h', mtime: 1, size: 1, documentId: 'd', chunkCount: 1, ingestedAt: 0 });
    const bm25 = new BM25Index();
    const lance = new FakeLance();
    const report = await compactStore({
      manifest, bm25, bm25File: join(dir, 'bm25.json'), lance: lance as never,
    });
    expect(report).toMatchObject({ scanned: 1, removed: 0, kept: 1 });
  });

  it('reports empty when manifest is empty', async () => {
    const manifest = new IngestManifest(join(dir, 'manifest.json'));
    await manifest.load();
    const report = await compactStore({
      manifest, bm25: new BM25Index(),
      bm25File: join(dir, 'bm25.json'),
      lance: new FakeLance() as never,
    });
    expect(report).toMatchObject({ scanned: 0, removed: 0, kept: 0 });
  });
});
