import { z } from 'zod';
import { SourceSchema } from './source.js';

export const CitationSchema = z.object({
  n: z.number().int().positive(),
  sourceId: z.string(),
  path: z.string(),
  line: z.number().int().nonnegative(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const AnswerSchema = z.object({
  text: z.string(),
  sources: z.array(SourceSchema),
  citations: z.array(CitationSchema),
  model: z.string(),
  latencyMs: z.number(),
});
export type Answer = z.infer<typeof AnswerSchema>;

export const StreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('token'), value: z.string() }),
  z.object({ type: z.literal('sources'), value: z.array(SourceSchema) }),
  z.object({ type: z.literal('citation'), value: CitationSchema }),
  z.object({ type: z.literal('done'), value: z.object({ latencyMs: z.number(), model: z.string() }) }),
  z.object({ type: z.literal('error'), value: z.object({ message: z.string() }) }),
]);
export type StreamEvent = z.infer<typeof StreamEventSchema>;
