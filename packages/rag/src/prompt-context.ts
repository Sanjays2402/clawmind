import type { RetrievedChunk } from '@clawmind/types';

export function toPromptContext(hits: RetrievedChunk[], maxChars = 16_000) {
  const items: { n: number; path: string; lines: string; excerpt: string }[] = [];
  let used = 0;
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]!;
    const excerpt = h.text.length > 1200 ? h.text.slice(0, 1200) + '...' : h.text;
    if (used + excerpt.length > maxChars) break;
    used += excerpt.length;
    items.push({
      n: i + 1,
      path: h.path,
      lines: `${h.startLine}-${h.endLine}`,
      excerpt,
    });
  }
  return items;
}
