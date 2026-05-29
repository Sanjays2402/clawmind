import type { Chunk, Document } from '@clawmind/types';
import { approxTokenCount } from '@clawmind/llm';
import { slidingChunk } from './sliding.js';

// Splits on markdown headings, code fences, and blank-line paragraphs. Then
// falls back to sliding-window inside any oversized block.
export function semanticChunk(doc: Document, body: string, target = 320): Chunk[] {
  const blocks: { startLine: number; lines: string[] }[] = [];
  const lines = body.split('\n');
  let cur: { startLine: number; lines: string[] } = { startLine: 0, lines: [] };
  let inFence = false;

  const flush = (i: number) => {
    if (cur.lines.length > 0) blocks.push(cur);
    cur = { startLine: i, lines: [] };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^```/.test(line)) {
      if (inFence) {
        cur.lines.push(line);
        flush(i + 1);
        inFence = false;
        continue;
      }
      flush(i);
      inFence = true;
      cur.lines.push(line);
      continue;
    }
    if (!inFence && /^#{1,6}\s/.test(line)) {
      flush(i);
      cur.lines.push(line);
      continue;
    }
    if (!inFence && line.trim() === '' && cur.lines.length > 8) {
      flush(i + 1);
      continue;
    }
    cur.lines.push(line);
  }
  flush(lines.length);

  const out: Chunk[] = [];
  let ord = 0;
  for (const b of blocks) {
    const text = b.lines.join('\n').trim();
    if (!text) continue;
    const tokens = approxTokenCount(text);
    if (tokens > target * 1.5) {
      const subDoc: Document = { ...doc };
      const sub = slidingChunk(subDoc, text, { targetTokens: target });
      for (const c of sub) {
        out.push({
          ...c,
          id: `${doc.id}:${ord}`,
          ord,
          startLine: b.startLine + c.startLine,
          endLine: b.startLine + c.endLine,
        });
        ord += 1;
      }
    } else {
      out.push({
        id: `${doc.id}:${ord}`,
        documentId: doc.id,
        path: doc.path,
        namespace: doc.namespace,
        text,
        startLine: b.startLine + 1,
        endLine: b.startLine + b.lines.length,
        tokens,
        ord,
      });
      ord += 1;
    }
  }
  return out;
}
