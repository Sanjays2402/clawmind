import { describe, it, expect } from 'vitest';
import { IngestManifest } from '../src/manifest.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('IngestManifest', () => {
  it('tracks reindex needs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cm-'));
    const m = new IngestManifest(join(dir, 'm.json'));
    await m.load();
    expect(m.needsReindex('/a', 'h1', 1)).toBe(true);
    m.set({ path: '/a', hash: 'h1', mtime: 1, size: 10, documentId: 'd', chunkCount: 1, ingestedAt: 0 });
    expect(m.needsReindex('/a', 'h1', 1)).toBe(false);
    expect(m.needsReindex('/a', 'h2', 1)).toBe(true);
    await m.save();
    const m2 = new IngestManifest(join(dir, 'm.json'));
    await m2.load();
    expect(m2.size()).toBe(1);
  });
});
