import { z } from 'zod';

export const NamespaceSchema = z.enum(['memory', 'projects', 'sessions', 'docs', 'misc']);
export type Namespace = z.infer<typeof NamespaceSchema>;

export const DocumentSchema = z.object({
  id: z.string(),
  path: z.string(),
  namespace: NamespaceSchema,
  title: z.string().nullable(),
  mtime: z.number(),
  size: z.number(),
  hash: z.string(),
  frontmatter: z.record(z.unknown()).optional(),
  language: z.string().optional(),
});
export type Document = z.infer<typeof DocumentSchema>;
