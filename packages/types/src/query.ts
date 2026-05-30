import { z } from 'zod';
import { NamespaceSchema } from './document.js';

export const QuerySchema = z.object({
  q: z.string().min(1).max(2000),
  namespaces: z.array(NamespaceSchema).optional(),
  k: z.number().int().min(1).max(50).default(8),
  mmrLambda: z.number().min(0).max(1).default(0.5),
  hybridAlpha: z.number().min(0).max(1).default(0.5),
  expand: z.boolean().default(true),
  /** Restrict retrieval to sources carrying at least one of these tags. */
  includeTags: z.array(z.string()).optional(),
  /** Drop sources carrying any of these tags from retrieval. */
  excludeTags: z.array(z.string()).optional(),
  /**
   * Optional cap on the total approximate tokens stuffed into the LLM
   * prompt context. Excerpts are dropped from the lowest-ranked end
   * first so the most relevant chunks survive a tight budget. Useful
   * when targeting a small-context local model.
   */
  contextTokenBudget: z.number().int().positive().max(200_000).optional(),
});
export type Query = z.infer<typeof QuerySchema>;
