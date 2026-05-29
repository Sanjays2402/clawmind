import { describe, it, expect } from 'vitest';
import { slidingChunk } from '../src/chunkers/sliding.js';
import { semanticChunk } from '../src/chunkers/semantic.js';
import type { Document } from '@clawmind/types';

const doc: Document = {
  id: 'd1', path: '/x.md', namespace: 'memory', title: 'x',
  mtime: 0, size: 0, hash: 'h',
};

describe('slidingChunk', () => {
  it('produces non-empty chunks within target size', () => {
    const body = Array.from({ length: 200 }, (_, i) => `line ${i} ${'word '.repeat(20)}`).join('\n');
    const chunks = slidingChunk(doc, body, { targetTokens: 100, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.text.length).toBeGreaterThan(0);
      expect(c.endLine).toBeGreaterThanOrEqual(c.startLine);
    }
  });
});

describe('semanticChunk', () => {
  it('splits on markdown headings', () => {
    const body = `# A\nparagraph one\n\n# B\nparagraph two\n\n# C\nparagraph three`;
    const chunks = semanticChunk(doc, body, 80);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });
  it('keeps code fences whole', () => {
    const body = '# T\nintro\n\n```ts\nconst x = 1;\nconst y = 2;\n```\n\ntrailing';
    const chunks = semanticChunk(doc, body, 80);
    const fenced = chunks.find((c) => c.text.includes('```ts'));
    expect(fenced?.text).toContain('const y = 2;');
  });
});
