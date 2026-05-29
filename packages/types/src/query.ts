import { z } from 'zod';
import { NamespaceSchema } from './document.js';

export const QuerySchema = z.object({
  q: z.string().min(1).max(2000),
  namespaces: z.array(NamespaceSchema).optional(),
  k: z.number().int().min(1).max(50).default(8),
  mmrLambda: z.number().min(0).max(1).default(0.5),
  hybridAlpha: z.number().min(0).max(1).default(0.5),
});
export type Query = z.infer<typeof QuerySchema>;
