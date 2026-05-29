import { z } from 'zod';

export const SourceSchema = z.object({
  id: z.string(),
  path: z.string(),
  title: z.string().nullable(),
  startLine: z.number(),
  endLine: z.number(),
  excerpt: z.string(),
  score: z.number(),
});
export type Source = z.infer<typeof SourceSchema>;
