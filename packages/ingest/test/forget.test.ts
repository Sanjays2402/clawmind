import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forgetSources } from '../src/forget.js';
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
  dir = mkdtempSync(join(tmpdir(), 'cm-forget-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

function seed() {
  const manifest = new IngestManifest(join(dir, 'manifest.json'));
  // synchronous seed - no on-disk file yet, load is a no-op
  const a = '/ws/notes/secret/passwords.md';
  const b = '/ws/notes/public/intro.md';
  const c = '/ws/scratch/scratchpad.md';
  manifest.set({ path: a, hash: 'h', mtime: 0, size: 1, documentId: 'doc-a', chunkCount: 2, ingestedAt: 0 });
  manifest.set({ path: b, hash: 'h', mtime: 0, size: 1, documentId: 'doc-b', chunkCount: 1, ingestedAt: 0 });
  manifest.set({ path: c, hash: 'h', mtime: 0, size: 1, documentId: 'doc-c', chunkCount: 3, ingestedAt: 0 });

  const bm25 = new BM25Index();
  bm25.add([
    chunk('a1', 'doc-a', a), chunk('a2', 'doc-a', a),
    chunk('b1', 'doc-b', b),
    chunk('c1', 'doc-c', c), chunk('c2', 'doc-c', c), chunk('c3', 'doc-c', c),
  ]);
  return { manifest, bm25, paths: { a, b, c } };
}

describe('forgetSources', () => {
  it('returns empty when no patterns are given', async () => {
    const { manifest, bm25 } = seed();
    const r = await forgetSources({
      manifest, bm25, bm25File: join(dir, 'bm25.json'),
      lance: new FakeLance() as never,
      patterns: [],
    });
    expect(r).toEqual({ matched: 0, removedChunks: 0, removedPaths: [], dryRun: false });
    expect(manifest.size()).toBe(3);
    expect(bm25.size()).toBe(6);
  });

  it('removes entries matching a glob across all three stores', async () => {
    const { manifest, bm25, paths } = seed();
    const lance = new FakeLance();
    const r = await forgetSources({
      manifest, bm25, bm25File: join(dir, 'bm25.json'),
      lance: lance as never,
      patterns: ['**/secret/**', '**/scratch/**'],
    });
    expect(r.matched).toBe(2);
    expect(r.removedChunks).toBe(5);
    expect(new Set(r.removedPaths)).toEqual(new Set([paths.a, paths.c]));
    expect(new Set(lance.deleted)).toEqual(new Set(['doc-a', 'doc-c']));
    expect(manifest.get(paths.a)).toBeUndefined();
    expect(manifest.get(paths.b)).toBeDefined();
    expect(manifest.get(paths.c)).toBeUndefined();
    expect(bm25.size()).toBe(1);
  });

  it('dry-run reports matches without mutating state', async () => {
    const { manifest, bm25, paths } = seed();
    const lance = new FakeLance();
    const r = await forgetSources({
      manifest, bm25, bm25File: join(dir, 'bm25.json'),
      lance: lance as never,
      patterns: ['**/notes/**'],
      dryRun: true,
    });
    expect(r.dryRun).toBe(true);
    expect(r.matched).toBe(2);
    expect(r.removedChunks).toBe(3);
    expect(new Set(r.removedPaths)).toEqual(new Set([paths.a, paths.b]));
    expect(lance.deleted).toEqual([]);
    expect(manifest.size()).toBe(3);
    expect(bm25.size()).toBe(6);
  });

  it('returns zero matches when nothing matches the pattern', async () => {
    const { manifest, bm25 } = seed();
    const r = await forgetSources({
      manifest, bm25, bm25File: join(dir, 'bm25.json'),
      lance: new FakeLance() as never,
      patterns: ['**/nope/**'],
    });
    expect(r.matched).toBe(0);
    expect(manifest.size()).toBe(3);
  });
});
