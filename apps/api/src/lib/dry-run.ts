// Shared parser for the `?dry_run=true` query flag.
//
// The brief calls for every destructive endpoint to support a sandbox /
// preview mode that reports exactly what *would* happen without actually
// mutating any data. Keeping the parser in one place means:
//
//   1. The accepted truthy values are uniform across routes ("true", "1",
//      "yes", case-insensitive). A buyer testing one endpoint can trust
//      that the same flag works everywhere.
//   2. Routes never accidentally interpret an arbitrary non-empty string
//      as truthy, which would turn "dry_run=false" into a real deletion.
//   3. The audit-log convention ("<action>.dry_run") lives next to the
//      parser so the auditor always sees the same shape: a preview is a
//      real audit event, just with a distinct action suffix so it cannot
//      be confused with a write.
//
// The flag is intentionally a query param, not a body field, so it works
// for DELETE requests where bodies are awkward and for HEAD/preview style
// calls from a browser link.

import { z } from 'zod';

export const DryRunQuery = z.object({
  dry_run: z
    .string()
    .optional()
    .describe('Preview only; do not mutate. Accepts true/1/yes (case-insensitive).'),
});

export type DryRunQueryType = z.infer<typeof DryRunQuery>;

const TRUTHY = new Set(['true', '1', 'yes']);

export function isDryRun(value: string | undefined | null): boolean {
  if (!value) return false;
  return TRUTHY.has(String(value).trim().toLowerCase());
}

/**
 * Suffix appended to audit actions when an endpoint runs in dry-run mode.
 * Auditors filter on this to separate previews from real mutations.
 */
export const DRY_RUN_AUDIT_SUFFIX = '.dry_run';

export function auditAction(base: string, dryRun: boolean): string {
  return dryRun ? `${base}${DRY_RUN_AUDIT_SUFFIX}` : base;
}
