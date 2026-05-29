import { z } from 'zod';

export const AuditEventSchema = z.object({
  id: z.string(),
  ts: z.number(),
  actor: z.string(),
  action: z.string(),
  resource: z.string(),
  meta: z.record(z.unknown()).optional(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;
