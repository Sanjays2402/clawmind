import type { Citation, RetrievedChunk, Source } from '@clawmind/types';

export function buildSources(hits: RetrievedChunk[]): Source[] {
  return hits.map((h, i) => ({
    id: h.id,
    path: h.path,
    title: null,
    startLine: h.startLine,
    endLine: h.endLine,
    excerpt: h.text.length > 800 ? h.text.slice(0, 800) + '...' : h.text,
    score: h.score,
  })).map((s, i) => ({ ...s, _n: i + 1 } as Source));
}

export function extractCitations(answer: string, sources: Source[]): Citation[] {
  const found = new Set<number>();
  const re = /\[\^(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    const n = Number(m[1]);
    if (!Number.isFinite(n)) continue;
    if (n >= 1 && n <= sources.length) found.add(n);
  }
  return [...found].sort((a, b) => a - b).map((n) => {
    const s = sources[n - 1]!;
    return { n, sourceId: s.id, path: s.path, line: s.startLine };
  });
}
