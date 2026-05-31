// Central registry of API-key scopes recognised by the ClawMind API.
//
// Each route file pulls the relevant constant from here instead of repeating
// string literals. Keeping the source of truth in one module means:
//   1. The keys route can validate that a newly issued key only references
//      scopes that actually gate something, avoiding silent typos that look
//      restrictive but in practice grant everything (because no route
//      checks them).
//   2. Docs and the SCOPES.md reference are generated from the same list,
//      so the docs cannot drift away from what the server enforces.
//   3. Tests can iterate the full set when verifying that a key with
//      `['*']` succeeds and a key with `[]` (interpreted as unrestricted)
//      behaves as documented.
//
// Naming convention: `<resource>:<action>` where action is one of
//   read   non-mutating GETs
//   write  POST/PUT/PATCH/DELETE that change state
//   manage destructive or sensitive operations (delete-my-data, key issuance)
//
// The wildcard '*' grants every scope. An empty / undefined scope list on a
// key is treated as unrestricted for backwards compatibility (see
// services/api-keys.ts#hasScope).

export const Scopes = {
  Ask: 'ask:read',
  Search: 'search:read',
  Ingest: 'ingest:write',
  Maintenance: 'maintenance:write',

  HistoryRead: 'history:read',
  HistoryWrite: 'history:write',

  ConversationsRead: 'conversations:read',
  ConversationsWrite: 'conversations:write',

  SavedRead: 'saved:read',
  SavedWrite: 'saved:write',

  CollectionsRead: 'collections:read',
  CollectionsWrite: 'collections:write',

  PinsWrite: 'pins:write',
  MutesWrite: 'mutes:write',

  DigestsRead: 'digests:read',
  DigestsWrite: 'digests:write',

  SnapshotsRead: 'snapshots:read',
  SnapshotsWrite: 'snapshots:write',

  TagsRead: 'tags:read',
  TagsWrite: 'tags:write',

  AliasesRead: 'aliases:read',
  AliasesWrite: 'aliases:write',

  SourcesRead: 'sources:read',
  StaleRead: 'stale:read',
  RelatedRead: 'related:read',
  StatsRead: 'stats:read',
  DoctorRead: 'doctor:read',

  FeedbackWrite: 'feedback:write',
  ShareRead: 'share:read',
  ShareWrite: 'share:write',

  LifecycleManage: 'lifecycle:admin',
  KeysManage: 'keys:admin',
  AuditRead: 'audit:read',

  WebhooksRead: 'webhooks:read',
  WebhooksManage: 'webhooks:admin',

  // Workspace-managed outbound webhook destination allowlist (egress).
  // Owners can lock outbound webhooks down to an approved set of
  // hostnames / suffix patterns, enforced at create, update, and on
  // every delivery attempt. Read is granted to admins+ so a delegated
  // operator can audit the closed list; Write is owner-only with MFA
  // step-up because tightening it can immediately stop in-flight
  // deliveries to a revoked receiver.
  WebhookAllowlistRead: 'webhook-allowlist:read',
  WebhookAllowlistWrite: 'webhook-allowlist:write',

  UsageRead: 'usage:read',

  OnboardingRead: 'onboarding:read',
  OnboardingWrite: 'onboarding:write',

  NotificationsRead: 'notifications:read',
  NotificationsWrite: 'notifications:write',

  NotificationPrefsRead: 'notification-prefs:read',
  NotificationPrefsWrite: 'notification-prefs:write',

  ProfileRead: 'profile:read',
  ProfileWrite: 'profile:write',

  IpAllowlistRead: 'ip-allowlist:read',
  IpAllowlistWrite: 'ip-allowlist:write',

  SessionsRead: 'sessions:read',
  SessionsManage: 'sessions:admin',

  MfaRead: 'mfa:read',
  MfaManage: 'mfa:admin',

  RetentionRead: 'retention:read',
  RetentionManage: 'retention:admin',

  // Unified admin console aggregator. Read-only by design; surfaces
  // counts that come from already-gated services so a key cannot use
  // this scope to escape role checks elsewhere.
  AdminRead: 'admin:read',

  // Members / RBAC. Read is granted to admins+ so a delegated operator
  // can see who has access; Manage is owner+admin only and is the gate
  // for invite/role-change/remove (with MFA step-up).
  MembersRead: 'members:read',
  MembersManage: 'members:admin',

  // Email-token workspace invitations. Read lists pending/accepted/revoked
  // invites (admin+). Manage covers create and revoke (owner+admin, MFA).
  // Accept is intentionally unscoped: the invitee redeems with their auth
  // session and the raw single-use token, no API key required.
  InvitationsRead: 'invitations:read',
  InvitationsManage: 'invitations:admin',

  // Domain auto-join policies. Read lists configured policies (admin+);
  // Manage replaces the policy table (owner+admin, MFA step-up). Policies
  // only ever assign 'member' or 'viewer' on first login; promotion to
  // admin/owner still requires an explicit invite.
  DomainPoliciesRead: 'domain-policies:read',
  DomainPoliciesManage: 'domain-policies:admin',

  // Workspace-wide legal hold. Read is granted to admins+ so compliance
  // operators can see whether deletion is suppressed; Manage is owner-only
  // (with MFA step-up) because an active hold overrides per-user GDPR
  // erase and scheduled retention sweeps.
  LegalHoldRead: 'legal-hold:read',
  LegalHoldManage: 'legal-hold:admin',

  // Workspace freeze (kill switch). Read lets admins see whether the
  // workspace is currently paused; Manage gates owner-only freeze /
  // unfreeze with MFA step-up. While frozen, every mutating route
  // outside the freeze/auth/export allowlist returns 423 Locked.
  WorkspaceFreezeRead: 'workspace-freeze:read',
  WorkspaceFreezeManage: 'workspace-freeze:admin',

  // Workspace policy documents (TOS / DPA / AUP) and per-user acceptance
  // records. Read is granted to every authenticated caller so the UI can
  // render the accept screen and any client can detect the 451 gate.
  // Accept is a separate scope so a narrow read-only key cannot record
  // an acceptance on behalf of its owner. Manage is owner-only (with MFA
  // step-up at the route) because publishing a new required policy can
  // immediately gate every other user out of normal API use.
  PoliciesRead: 'policies:read',
  PoliciesAccept: 'policies:write',
  PoliciesManage: 'policies:admin',

  // Workspace-wide MFA enforcement policy. Read is admin+ so compliance
  // operators can confirm the property is in force; Manage is owner-only
  // with MFA step-up at the route because flipping the switch on can
  // immediately gate every other session user out of writes.
  MfaPolicyRead: 'mfa-policy:read',
  MfaPolicyManage: 'mfa-policy:admin',

  SessionPolicyRead: 'session-policy:read',
  SessionPolicyManage: 'session-policy:admin',

  // Tenant-wide GDPR / data-portability export. Per-user export already
  // lives under LifecycleManage; this is the owner-only "everything in
  // the workspace" path required by enterprise exit clauses. A narrow
  // read scope is exposed too so an auditor can pull a preview / count
  // estimate without being able to download the full bundle.
  WorkspaceExportRead: 'workspace-export:read',
  WorkspaceExportManage: 'workspace-export:admin',

  // Workspace query blocklist. Owner-managed list of literal/regex
  // patterns that any inbound query (ask / search / explain) is matched
  // against BEFORE retrieval or LLM call. Read is admin+ so an auditor
  // can review the closed set; Manage is owner-only (with MFA step-up)
  // because adding a broken regex or an overly aggressive literal can
  // immediately stop every query path in the workspace.
  QueryBlocklistRead: 'query-blocklist:read',
  QueryBlocklistManage: 'query-blocklist:admin',
} as const;

export type ScopeName = (typeof Scopes)[keyof typeof Scopes];

export const KNOWN_SCOPES: readonly ScopeName[] = Object.freeze(
  Object.values(Scopes) as ScopeName[],
);

export function isKnownScope(s: string): s is ScopeName {
  return (KNOWN_SCOPES as readonly string[]).includes(s);
}
