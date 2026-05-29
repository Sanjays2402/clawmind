import type { RetrievedChunk } from '@clawmind/types';

// A cheap heuristic reranker that boosts chunks containing exact query terms
// near document headings or short, focused passages. No external model call.
export function lexicalRerank(query: string, hits: RetrievedChunk[]): RetrievedChunk[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
  return [...hits]
    .map((h) => {
      const lower = h.text.toLowerCase();
      let bonus = 0;
      for (const t of terms) {
        const occurrences = lower.split(t).length - 1;
        bonus += occurrences * 0.02;
      }
      // prefer compact passages
      const lenPenalty = Math.min(0.1, Math.max(0, (h.text.length - 1500) / 30_000));
      return { ...h, score: h.score + bonus - lenPenalty };
    })
    .sort((a, b) => b.score - a.score);
}
