import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDoctor } from '../src/services/doctor.js';
import { BM25Index, IngestManifest } from '@clawmind/store';
import type { Chunk } from '@clawmind/types';

class FakeLance {
  constructor(private n: number) {}
  async count() { return this.n; }
}

function chunk(id: string, documentId: string, path: string): Chunk {
  return { id, documentId, path, namespace: 'docs', text: 't', startLine: 0, endLine: 0, tokens: 1, ord: 0 } as Chunk;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-doctor-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('runDoctor', () => {
  it('flags an empty index', async () => {
    const m = new IngestManifest(join(dir, 'm.json'));
    const report = await runDoctor({ manifest: m, bm25: new BM25Index(), lance: new FakeLance(0) as never });
    expect(report.ok).toBe(true);
    expect(report.findings.some((f) => f.code === 'EMPTY_INDEX')).toBe(true);
  });

  it('reports ok when all three stores agree and ingest is fresh', async () => {
    const m = new IngestManifest(join(dir, 'm.json'));
    m.set({ path: '/a.md', hash: 'h', mtime: 0, size: 1, documentId: 'd1', chunkCount: 3, ingestedAt: Date.now() });
    const bm = new BM25Index();
    bm.add([chunk('1', 'd1', '/a.md'), chunk('2', 'd1', '/a.md'), chunk('3', 'd1', '/a.md')]);
    const report = await runDoctor({ manifest: m, bm25: bm, lance: new FakeLance(3) as never });
    expect(report.ok).toBe(true);
    expect(report.counts).toEqual({ manifestDocs: 1, manifestChunks: 3, bm25Chunks: 3, lanceChunks: 3 });
    expect(report.findings.filter((f) => f.severity !== 'info')).toHaveLength(0);
  });

  it('errors on large BM25 drift', async () => {
    const m = new IngestManifest(join(dir, 'm.json'));
    m.set({ path: '/a.md', hash: 'h', mtime: 0, size: 1, documentId: 'd1', chunkCount: 100, ingestedAt: Date.now() });
    const report = await runDoctor({ manifest: m, bm25: new BM25Index(), lance: new FakeLance(100) as never });
    const drift = report.findings.find((f) => f.code === 'BM25_DRIFT');
    expect(drift?.severity).toBe('error');
    expect(report.ok).toBe(false);
  });

  it('warns on small lance drift', async () => {
    const m = new IngestManifest(join(dir, 'm.json'));
    m.set({ path: '/a.md', hash: 'h', mtime: 0, size: 1, documentId: 'd1', chunkCount: 100, ingestedAt: Date.now() });
    const bm = new BM25Index();
    for (let i = 0; i < 100; i++) bm.add([chunk(String(i), 'd1', '/a.md')]);
    const report = await runDoctor({ manifest: m, bm25: bm, lance: new FakeLance(98) as never });
    const drift = report.findings.find((f) => f.code === 'LANCE_DRIFT');
    expect(drift?.severity).toBe('warn');
    expect(report.ok).toBe(true);
  });

  it('warns on stale index', async () => {
    const m = new IngestManifest(join(dir, 'm.json'));
    m.set({ path: '/a.md', hash: 'h', mtime: 0, size: 1, documentId: 'd1', chunkCount: 1, ingestedAt: 0 });
    const bm = new BM25Index();
    bm.add([chunk('1', 'd1', '/a.md')]);
    const report = await runDoctor({ manifest: m, bm25: bm, lance: new FakeLance(1) as never, staleAfterMs: 1 });
    expect(report.findings.some((f) => f.code === 'STALE_INDEX')).toBe(true);
  });

  it('reports zero-chunk docs as info, not failure', async () => {
    const m = new IngestManifest(join(dir, 'm.json'));
    m.set({ path: '/a.md', hash: 'h', mtime: 0, size: 0, documentId: 'd1', chunkCount: 0, ingestedAt: Date.now() });
    const report = await runDoctor({ manifest: m, bm25: new BM25Index(), lance: new FakeLance(0) as never });
    const f = report.findings.find((x) => x.code === 'EMPTY_DOCS');
    expect(f?.severity).toBe('info');
    expect(report.ok).toBe(true);
  });
});
