import type { Chunk, Document } from '@clawmind/types';
import { approxTokenCount } from '@clawmind/llm';

export interface SlidingOptions {
  targetTokens?: number;
  overlapTokens?: number;
  minChars?: number;
}

export function slidingChunk(doc: Document, body: string, opts: SlidingOptions = {}): Chunk[] {
  const target = opts.targetTokens ?? 320;
  const overlap = opts.overlapTokens ?? 48;
  const minChars = opts.minChars ?? 80;
  const lines = body.split('\n');
  const chunks: Chunk[] = [];
  let buf: string[] = [];
  let start = 0;
  let ord = 0;

  const flush = (endLine: number) => {
    const text = buf.join('\n').trim();
    if (text.length >= minChars) {
      chunks.push({
        id: `${doc.id}:${ord}`,
        documentId: doc.id,
        path: doc.path,
        namespace: doc.namespace,
        text,
        startLine: start + 1,
        endLine: endLine + 1,
        tokens: approxTokenCount(text),
        ord,
      });
      ord += 1;
    }
  };

  let tokensInBuf = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineTokens = approxTokenCount(line);
    if (tokensInBuf + lineTokens > target && buf.length > 0) {
      flush(i - 1);
      // overlap: keep tail
      const tail: string[] = [];
      let tailTokens = 0;
      for (let j = buf.length - 1; j >= 0 && tailTokens < overlap; j--) {
        tail.unshift(buf[j]!);
        tailTokens += approxTokenCount(buf[j]!);
      }
      start = i - tail.length;
      buf = [...tail, line];
      tokensInBuf = tailTokens + lineTokens;
    } else {
      buf.push(line);
      tokensInBuf += lineTokens;
    }
  }
  flush(lines.length - 1);
  return chunks;
}
