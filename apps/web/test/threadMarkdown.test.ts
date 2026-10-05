import { describe, it, expect } from 'vitest';
import { threadToMarkdown, threadFileName, sourceRef } from '../src/lib/threadMarkdown';

const at = new Date('2026-10-05T14:32:00Z');

describe('threadToMarkdown', () => {
  it('renders each exchange with its own numbered sources', () => {
    const md = threadToMarkdown(
      [
        {
          question: 'Why LanceDB?',
          answer: 'Because it is embedded [1] and fast [^2].',
          sources: [
            { path: '/m/a.md', startLine: 1, endLine: 4 },
            { path: '/m/b.md', startLine: 7, endLine: 7, displayPath: 'memory/b.md' },
          ],
        },
        { question: 'And BM25?', answer: 'Lexical recall [1].', sources: [{ path: '/m/c.md', startLine: 2, endLine: 9 }] },
      ],
      at,
    );
    expect(md).toContain('# ClawMind thread');
    expect(md).toContain('_Exported 2026-10-05 14:32 UTC · 2 exchanges_');
    expect(md).toContain('## 1. Why LanceDB?');
    expect(md).toContain('fast [2].');
    expect(md).not.toContain('[^2]');
    expect(md).toContain('1. `/m/a.md:1-4`');
    expect(md).toContain('2. `memory/b.md:7`');
    expect(md).toContain('## 2. And BM25?');
    expect(md).toContain('1. `/m/c.md:2-9`');
    expect(md.indexOf('## 1.')).toBeLessThan(md.indexOf('## 2.'));
  });

  it('records failed and partial answers honestly', () => {
    const md = threadToMarkdown(
      [
        { question: 'q1', answer: '', sources: [], error: 'LLM timeout' },
        { question: 'q2', answer: 'half', sources: [], error: 'stream closed' },
      ],
      at,
    );
    expect(md).toContain('> _No answer: LLM timeout._');
    expect(md).toContain('half\n\n> _Answer stopped early: stream closed._');
    expect(md).not.toContain('**Sources**');
  });

  it('collapses whitespace in question headings', () => {
    expect(threadToMarkdown([{ question: ' a\n  b ', answer: 'x', sources: [] }], at)).toContain('## 1. a b');
  });
});

describe('helpers', () => {
  it('formats source refs and file names', () => {
    expect(sourceRef({ path: '/p', startLine: 0, endLine: 0 })).toBe('/p:1');
    expect(threadFileName(at)).toBe('clawmind-thread-2026-10-05-1432.md');
  });
});
