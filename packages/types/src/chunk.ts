import { z } from 'zod';
import { NamespaceSchema } from './document.js';

export const ChunkSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  path: z.string(),
  namespace: NamespaceSchema,
  text: z.string(),
  startLine: z.number().int().nonnegative(),
  endLine: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  ord: z.number().int().nonnegative(),
  embedding: z.array(z.number()).optional(),
});
export type Chunk = z.infer<typeof ChunkSchema>;

export const RetrievedChunkSchema = ChunkSchema.extend({
  score: z.number(),
  bm25Score: z.number().optional(),
  denseScore: z.number().optional(),
  mmrScore: z.number().optional(),
});
export type RetrievedChunk = z.infer<typeof RetrievedChunkSchema>;
