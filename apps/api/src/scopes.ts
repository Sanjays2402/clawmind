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

  UsageRead: 'usage:read',

  OnboardingRead: 'onboarding:read',
  OnboardingWrite: 'onboarding:write',

  NotificationsRead: 'notifications:read',
  NotificationsWrite: 'notifications:write',

  ProfileRead: 'profile:read',
  ProfileWrite: 'profile:write',
} as const;

export type ScopeName = (typeof Scopes)[keyof typeof Scopes];

export const KNOWN_SCOPES: readonly ScopeName[] = Object.freeze(
  Object.values(Scopes) as ScopeName[],
);

export function isKnownScope(s: string): s is ScopeName {
  return (KNOWN_SCOPES as readonly string[]).includes(s);
}
