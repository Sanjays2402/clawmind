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
  /**
   * Owner-only authority to record a fresh tamper-evident anchor over
   * the audit chain head. Separate from AuditRead so a delegated
   * reviewer can read and verify history without being able to mint a
   * new anchor that subsequent truncation detection would key off of.
   * Uses :admin since recording an anchor is a privileged mutation
   * that downstream verification keys off of.
   */
  AuditAnchor: 'audit:admin',

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
  WebhookEventsAllowlistRead: 'webhook-events-allowlist:read',
  WebhookEventsAllowlistWrite: 'webhook-events-allowlist:write',

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

  // Workspace-wide browser Origin (CORS) allowlist. Read is granted to
  // admins+ so an operator can see what browsers are permitted; Write is
  // owner-only with MFA step-up because a bad rule can break every
  // browser-based integration the workspace ships.
  OriginAllowlistRead: 'origin-allowlist:read',
  OriginAllowlistWrite: 'origin-allowlist:write',

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

  // Offboarding sweep / orphaned credentials. Read lists keys whose owning
  // userId is no longer in the member registry (a historical orphan or a
  // race between membership and credential cleanup). Manage is owner-only
  // with MFA step-up because revoking a key immediately breaks any client
  // that still presents it, and an attacker who can flip an arbitrary key
  // off can break production deploys.
  OffboardingRead: 'offboarding:read',
  OffboardingManage: 'offboarding:admin',

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

  // Workspace-wide API-key issuance policy. Caps TTL, key count, scope
  // count and wildcard usage at the moment keys are minted, plus a
  // rotation reminder threshold. Read is admin+ so auditors can confirm
  // the property is in force; Manage is owner-only with MFA step-up at
  // the route because tightening it can immediately reject the next
  // attempt to mint a key in CI.
  ApiKeyPolicyRead: 'api-key-policy:read',
  ApiKeyPolicyManage: 'api-key-policy:admin',

  // Workspace API-key inactivity sweep policy. SOC2 CC6.1 control:
  // auto-revoke API keys that have not been used in an owner-configured
  // window. Read is admin+ so auditors can confirm the threshold and
  // last sweep time; Manage is owner-only with MFA at the route because
  // sweeping immediately invalidates credentials in flight.
  ApiKeyInactivityRead: 'api-key-inactivity:read',
  ApiKeyInactivityManage: 'api-key-inactivity:admin',

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

  // Periodic access reviews (SOC2 CC6.3 / ISO 27001 A.9.2.5). Read is
  // admin+ so a compliance operator can pull historic recertifications;
  // Manage is owner-only with MFA step-up because closing a review can
  // immediately downgrade or revoke members across the workspace.
  AccessReviewsRead: 'access-reviews:read',
  AccessReviewsManage: 'access-reviews:admin',

  // Workspace-wide monthly request quota. Read is admin+ so finance /
  // compliance can confirm the configured cap; Manage is owner-only
  // because lowering the cap can immediately 429 every other member's
  // ask/search/batch call. The check is enforced at the route layer
  // (see ask/search/batch).
  WorkspaceQuotaRead: 'workspace-quota:read',
  WorkspaceQuotaManage: 'workspace-quota:admin',

  // Sub-processor registry (GDPR Article 28 disclosure). Read is admin+
  // because the operator view surfaces internal notes and updatedBy;
  // the public projection at GET /v1/sub-processors has no auth at all
  // by design so customer DPAs can cite a stable URL. Manage is
  // owner-only with MFA step-up at the route because adding a new
  // sub-processor is a regulatory disclosure that broadcasts an
  // in-app notification to every member.
  SubProcessorsRead: 'sub-processors:read',
  SubProcessorsManage: 'sub-processors:admin',

  // Workspace data residency policy. Read is admin+ so a compliance
  // operator can quote the configured allow-list and current server
  // region in a DPA; Manage is owner-only with MFA step-up because
  // tightening the policy can immediately 451 every member's writes
  // until the request is routed to a compliant region.
  DataResidencyRead: 'data-residency:read',
  DataResidencyManage: 'data-residency:admin',

  // Data Subject Request queue (GDPR Art. 15/17, CCPA §1798.110/.105).
  // Read is admin+ so a compliance operator can pull the queue, audit
  // SLA timers, and demonstrate intake exists during a procurement
  // review. Manage is owner-only with MFA step-up at the route because
  // moving a request to 'fulfilled' is a regulatory attestation and
  // closes the legally required 30-day clock. The public submission
  // endpoint (POST /v1/dsr/submit) is intentionally unauthenticated by
  // design so non-members can exercise their statutory rights.
  DsrRead: 'dsr:read',
  DsrManage: 'dsr:admin',

  // Workspace Trust Center. Read is admin+ so a compliance operator
  // can pull the operator view that includes updatedBy; Manage is
  // owner-only with MFA step-up at the route because edits land on a
  // public, internet-facing page that procurement teams cite by URL.
  TrustRead: 'trust:read',
  TrustManage: 'trust:admin',

  // Security Incident Disclosure Log. Read is admin+ so a compliance
  // operator can see the operator view (private notes, updatedBy);
  // Manage is owner-only with MFA step-up at the route because writes
  // land on a public, internet-facing timeline that procurement teams
  // and regulators cite by URL.
  IncidentsRead: 'incidents:read',
  IncidentsManage: 'incidents:admin',

  // Workspace PII redaction policy. Read is admin+ so a compliance
  // operator can see which detector classes are active without being
  // able to weaken them. Manage is owner-only with MFA step-up because
  // turning a class to 'off' immediately allows secrets to flow to the
  // LLM provider on the next /v1/ask call.
  PiiRedactionRead: 'pii-redaction:read',
  PiiRedactionManage: 'pii-redaction:admin',

  // Break-glass / time-bound role elevation. Read is admin+ so an
  // operator can see who currently holds elevated access; Manage is
  // owner-only with MFA step-up at the route because approving a
  // request mints temporary owner-equivalent privileges. Requesters
  // hit the create endpoint with their session, no API-key scope is
  // needed there because a request is a human attestation, not an
  // automated mutation worth scoping for service accounts.
  RoleElevationRead: 'role-elevation:read',
  RoleElevationRequest: 'role-elevation:write',
  RoleElevationManage: 'role-elevation:admin',

  // Sign-in activity log. The self-view (SignInLogRead) lets a user audit
  // their own login history from any client, which is the table-stakes
  // "recent sign-ins" surface every enterprise security review asks for.
  // SignInLogReadAll is admin+ because the full feed includes failed
  // login attempts against arbitrary identifiers (probing); exposing it
  // to the wider org would itself be a low-grade information leak.
  SignInLogRead: 'sign-in-log:read',
  SignInLogReadAll: 'sign-in-log:admin',
} as const;

export type ScopeName = (typeof Scopes)[keyof typeof Scopes];

export const KNOWN_SCOPES: readonly ScopeName[] = Object.freeze(
  Object.values(Scopes) as ScopeName[],
);

export function isKnownScope(s: string): s is ScopeName {
  return (KNOWN_SCOPES as readonly string[]).includes(s);
}
