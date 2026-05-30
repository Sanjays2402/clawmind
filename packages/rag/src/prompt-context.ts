import type { RetrievedChunk } from '@clawmind/types';
import { approxTokenCount } from '@clawmind/llm';

export interface PromptContextItem {
  n: number;
  path: string;
  lines: string;
  excerpt: string;
}

export interface PromptContextOptions {
  /**
   * Hard cap on the total characters across all included excerpts. Cheap
   * upper bound that keeps callers safe from pathological hit text even
   * when no token budget is configured.
   */
  maxChars?: number;
  /**
   * Optional cap on the approximate token count across all included
   * excerpts. When set, excerpts are dropped from the lowest-ranked end
   * first, so the most relevant context survives a tight budget.
   *
   * Token counts use the cheap word-and-character approximation from
   * @clawmind/llm; the error bar is well within typical retrieval budgets
   * but callers expecting exact tiktoken parity should leave headroom.
   */
  maxTokens?: number;
  /**
   * Per-excerpt character cap before any global trimming. Defaults to 1200
   * to preserve the original behaviour of toPromptContext.
   */
  perExcerptChars?: number;
}

const DEFAULTS = {
  maxChars: 16_000,
  perExcerptChars: 1200,
} as const;

function clipExcerpt(text: string, perExcerptChars: number): string {
  return text.length > perExcerptChars ? text.slice(0, perExcerptChars) + '...' : text;
}

/**
 * Build the prompt context list from ranked retrieval hits. Supports both
 * the legacy two-arg signature (a numeric maxChars) and an options object
 * for the newer token-budget aware path. When both maxChars and maxTokens
 * are in effect, the tighter of the two limits wins.
 */
export function toPromptContext(
  hits: RetrievedChunk[],
  optsOrMaxChars: number | PromptContextOptions = {},
): PromptContextItem[] {
  const opts: PromptContextOptions = typeof optsOrMaxChars === 'number'
    ? { maxChars: optsOrMaxChars }
    : optsOrMaxChars;
  const maxChars = opts.maxChars ?? DEFAULTS.maxChars;
  const perExcerptChars = opts.perExcerptChars ?? DEFAULTS.perExcerptChars;
  const maxTokens = opts.maxTokens;

  const items: PromptContextItem[] = [];
  let usedChars = 0;
  let usedTokens = 0;
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]!;
    const excerpt = clipExcerpt(h.text, perExcerptChars);
    if (usedChars + excerpt.length > maxChars) break;
    if (maxTokens !== undefined) {
      const t = approxTokenCount(excerpt);
      if (usedTokens + t > maxTokens) {
        // If we have nothing yet, partially fit by trimming this single
        // excerpt to the available token budget instead of returning empty.
        if (items.length === 0 && maxTokens > 0) {
          const ratio = maxTokens / Math.max(1, t);
          const trimmed = excerpt.slice(0, Math.max(1, Math.floor(excerpt.length * ratio)));
          items.push({
            n: 1,
            path: h.path,
            lines: `${h.startLine}-${h.endLine}`,
            excerpt: trimmed,
          });
        }
        break;
      }
      usedTokens += t;
    }
    usedChars += excerpt.length;
    items.push({
      n: i + 1,
      path: h.path,
      lines: `${h.startLine}-${h.endLine}`,
      excerpt,
    });
  }
  return items;
}
