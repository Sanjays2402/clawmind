import { z } from 'zod';

export const AuditEventSchema = z.object({
  id: z.string(),
  ts: z.number(),
  actor: z.string(),
  action: z.string(),
  resource: z.string(),
  meta: z.record(z.unknown()).optional(),
  // Tamper-evidence: each record commits to the prior record's hash so an
  // operator (or regulator) can replay the file and detect any insertion,
  // deletion, or in-place edit. The very first record in a chain uses the
  // GENESIS_PREV_HASH constant. Both fields are written by AuditLog.write
  // and are not accepted from callers.
  prevHash: z.string().optional(),
  hash: z.string().optional(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;
