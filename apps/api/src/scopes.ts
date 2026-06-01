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

  // Procurement Security Posture aggregator. Read-only, derived; produces
  // a single vendor-questionnaire-shaped scorecard from existing controls
  // (SSO, MFA policy, IP allowlist, audit chain + drain, residency,
  // share-policy, api-key-policy, session-policy, trust profile, freeze).
  // Distinct from AdminRead because a procurement reviewer / compliance
  // auditor often gets a posture key without operator counters. Read is
  // owner+admin (the report still leaks the configured shape of the
  // tenant's controls and would be a recon win for an attacker).
  PostureRead: 'posture:read',

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

  VendorAccessRead: 'vendor-access:read',
  VendorAccessManage: 'vendor-access:admin',

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

  // Upcoming API-key expiry warning. Surfaces TTL-based expiry (a
  // separate axis from inactivity) so customers can schedule rotations
  // before keys lapse and break integrations. Read is admin+ so an
  // auditor can pull the upcoming list; Manage is owner+MFA because
  // shrinking the warning window changes what every authenticated
  // request advertises in response headers.
  ApiKeyExpiryRead: 'api-key-expiry:read',
  ApiKeyExpiryManage: 'api-key-expiry:admin',

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

  // Indirect prompt-injection policy. Scans retrieved RAG context
  // for jailbreak / exfil / role-override payloads BEFORE the answer
  // is surfaced. Read is admin+ so an auditor can review which rules
  // are active (built-in seeds + workspace customs). Manage is
  // owner-only with MFA step-up because flipping the mode to `block`
  // can immediately 422 every /ask call hitting a poisoned chunk.
  PromptInjectionRead: 'prompt-injection:read',
  PromptInjectionManage: 'prompt-injection:admin',

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

  // Data Processing Agreement (DPA) acceptance registry. Read is
  // intentionally broad (admin+) so any compliance reviewer can pull
  // the on-file signatory and version. Manage is owner-only with MFA
  // step-up at the route because recording an acceptance is a binding
  // legal act that produces a signed receipt.
  DpaRead: 'dpa:read',
  DpaManage: 'dpa:admin',

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

  // Personal Data Breach Notification Register (GDPR Art. 33/34). Read is
  // admin+ so a compliance operator can pull the operator view
  // (internalNotes, updatedBy) without being able to file or amend a
  // regulatory disclosure. Manage is owner-only with MFA step-up at the
  // route because every entry is a notifiable-breach record the regulator
  // will cite; a silent edit is itself a compliance event.
  BreachRegisterRead: 'breach-register:read',
  BreachRegisterManage: 'breach-register:admin',

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

  // Workspace scheduled deletion (GDPR Article 17 right to erasure at
  // the tenant level). Read is admin+ so a delegated operator can see the
  // countdown without being able to schedule or cancel; Manage is
  // owner-only with MFA step-up at the route because scheduling a wipe
  // blocks every other write across the workspace and a wrongful cancel
  // can defeat a legally required retention deadline.
  WorkspaceDeletionRead: 'workspace-deletion:read',
  WorkspaceDeletionManage: 'workspace-deletion:admin',

  // Sign-in activity log. The self-view (SignInLogRead) lets a user audit
  // their own login history from any client, which is the table-stakes
  // "recent sign-ins" surface every enterprise security review asks for.
  // SignInLogReadAll is admin+ because the full feed includes failed
  // login attempts against arbitrary identifiers (probing); exposing it
  // to the wider org would itself be a low-grade information leak.
  SignInLogRead: 'sign-in-log:read',
  SignInLogReadAll: 'sign-in-log:admin',

  // Workspace encryption keys (CMEK / BYOK). Read is admin+ so a
  // compliance operator can quote the active KEK kind and key
  // fingerprint in a DPA without being able to rotate or replace it.
  // Manage is owner-only with MFA step-up at the route because
  // uploading a customer KEK, rotating the DEK, or removing the
  // customer KEK rewraps every encrypted artifact in the workspace
  // and a mistake can lock the tenant out of their own data.
  EncryptionRead: 'encryption:read',
  EncryptionManage: 'encryption:admin',

  // Workspace public-share policy. Read is admin+ so a compliance operator
  // can confirm whether public sharing is disabled, capped, or expiry-
  // required without being able to widen it. Manage is owner-only with
  // MFA step-up at the route because tightening it can immediately reject
  // the next /v1/share mint a member attempts.
  SharePolicyRead: 'share-policy:read',
  SharePolicyManage: 'share-policy:admin',

  // Sign-in geofence. Owner-managed allow/block list of ISO 3166 country
  // codes evaluated at OAuth/OIDC callback time. Read is owner-only so
  // an auditor without owner can confirm what is in force; Manage is
  // owner+MFA at the route because flipping the policy can lock the
  // entire workspace out from a given region on the next sign-in.
  SignInGeofenceRead: 'sign-in-geofence:read',
  SignInGeofenceManage: 'sign-in-geofence:admin',

  // Sign-in anomaly detection (impossible travel). Self-read lets a user
  // see and acknowledge their own anomalies; admin-read exposes the
  // workspace-wide queue including other actors' events for SOC triage.
  SignInAnomaliesRead: 'sign-in-anomalies:read',
  SignInAnomaliesReadAll: 'sign-in-anomalies:admin',

  // Workspace LLM model allowlist. Read is admin+ so a compliance
  // operator can quote the approved model set in a DPA without being
  // able to widen it. Manage is owner-only with MFA step-up at the
  // route because tightening it can immediately 422 the next /v1/ask
  // call whose fallback model is no longer approved.
  ModelAllowlistRead: 'model-allowlist:read',
  ModelAllowlistManage: 'model-allowlist:admin',

  // Pre-auth system-use notification banner (NIST SP 800-53 AC-8).
  LoginBannerRead: 'login-banner:read',
  LoginBannerManage: 'login-banner:admin',

  // Acceptable Use Policy (AUP).
  AcceptableUseRead: 'acceptable-use:read',
  AcceptableUseReadAll: 'acceptable-use:admin',
  AcceptableUseManage: 'acceptable-use:write',

  // Audit-log SIEM drains. Continuous push of the audit chain to one
  // or more workspace-configured HTTPS sinks (Splunk HEC, Datadog, or
  // a generic HMAC-signed webhook). Read is admin+ so a compliance
  // operator can confirm a drain is in force and inspect delivery
  // counters / dead-letters without being able to repoint the feed.
  // Manage is owner-only (with MFA step-up at the route) because
  // creating, updating, or deleting a drain changes where the audit
  // record of the workspace flows and that is itself a regulator-
  // visible event.
  AuditDrainsRead: 'audit-drains:read',
  AuditDrainsManage: 'audit-drains:admin',

  // Data classification (sensitivity labels). Read is admin+ so a
  // compliance operator can review every label and the workspace
  // sharing cap without being able to widen it. Manage is owner-only
  // with MFA step-up at the route because relabelling a path or
  // raising the cap can let the next /v1/share mint a link that the
  // previous policy would have blocked.
  ClassificationRead: 'classification:read',
  ClassificationManage: 'classification:admin',

  // Recovery contacts (SOC2 CC7.4 / BCP escalation list). Read is
  // admin+ so a compliance operator can pull the operator view
  // including private notes and updatedBy without being able to
  // change who appears on the buyer's incident-response runbook.
  // Manage is owner-only with MFA step-up at the route because
  // edits land on a public, internet-facing list that procurement
  // and IR teams cite by URL; a silent change can break a buyer's
  // playbook the next time they need it.
  RecoveryContactsRead: 'recovery-contacts:read',
  RecoveryContactsManage: 'recovery-contacts:admin',

  // Record of Processing Activities (GDPR Article 30). The public
  // projection at GET /v1/ropa has no auth at all by design so a
  // customer's DPA can cite a stable URL and their DPO can verify our
  // Art. 30 register exists. Read returns the operator view (private
  // notes, updatedBy) and is admin+. Manage is owner-only with MFA
  // step-up because every change is a regulatory disclosure that
  // broadcasts an in-app notification to every member.
  RopaRead: 'ropa:read',
  RopaManage: 'ropa:admin',

  // Warrant canary. Read is admin+ so a compliance operator can pull
  // the operator view (attestedBy / withdrawnBy / updatedBy) without
  // being able to sign or withdraw an attestation. Manage is owner-only
  // with MFA step-up at the route because every mutation is a
  // regulatory-adjacent public statement; a silent edit to the canary
  // is a much louder signal than the canary itself.
  WarrantCanaryRead: 'warrant-canary:read',
  WarrantCanaryManage: 'warrant-canary:admin',

  // Software Bill of Materials (CycloneDX 1.5). Read is admin+ so a
  // compliance operator can see the operator view (updatedBy) without
  // being able to alter the public attestation. Manage is owner-only
  // with MFA step-up at the route because edits land on a public,
  // internet-facing artefact that procurement teams and SCA tooling
  // ingest by URL; a silent commit / repository swap is a supply-chain
  // integrity event. The component graph itself is derived from disk
  // and is not editable from the network.
  SbomRead: 'sbom:read',
  SbomManage: 'sbom:admin',

  // GDPR Article 17 erasure receipts. The certificate file is a public
  // attestation the subject (and their regulator) can verify offline,
  // so the read scope only gates the admin LIST view. Issuance is a
  // side effect of fulfilling a DSR erasure row and is gated by
  // DsrManage at that boundary; there is no public mint surface.
  ErasureCertificatesRead: 'erasure-certificates:read',

  // Dual-control approvals (four-eyes / NIST AC-3(2) two-person
  // integrity). Read returns the pending and historical approval
  // ledger so an admin can see what's outstanding; Manage requests,
  // approves, or rejects entries. Both are owner-only at the route
  // because the entire point of the control is that only owners can
  // participate in approving destructive admin actions.
  DualControlRead: 'dual-control:read',
  DualControlManage: 'dual-control:admin',
} as const;

export type ScopeName = (typeof Scopes)[keyof typeof Scopes];

export const KNOWN_SCOPES: readonly ScopeName[] = Object.freeze(
  Object.values(Scopes) as ScopeName[],
);

export function isKnownScope(s: string): s is ScopeName {
  return (KNOWN_SCOPES as readonly string[]).includes(s);
}
