// Single shared API client for the web app. Every call hits the Fastify
// service running locally and returns plain JSON. Errors carry the upstream
// status code in the message so UIs can branch on it.

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:7410';

export const API_BASE = BASE;

export class ApiError extends Error {
  constructor(public status: number, public path: string, public body?: unknown) {
    super(`${path} ${status}`);
  }
}

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'include',
    cache: 'no-store',
  });
  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { body = await res.text().catch(() => null); }
    throw new ApiError(res.status, path, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface ChunkExplanation {
  id: string;
  path: string;
  displayPath?: string;
  namespace: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  bm25Raw: number | null;
  denseRaw: number | null;
  bm25Norm: number;
  denseNorm: number;
  hybridScore: number;
  rerankedScore: number;
  mmrScore: number | null;
  finalRank: number | null;
  inFinal: boolean;
}

export interface ExplainResponse {
  query: { original: string; expanded: string; added: string[]; corrections: Array<{ from: string; to: string }> };
  params: { hybridAlpha: number; mmrLambda: number; k: number };
  candidates: ChunkExplanation[];
  funnel: { bm25: number; dense: number; merged: number; afterFilter: number; afterRerank: number; final: number };
}

export interface Source {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  score: number;
  snippet?: { text: string; spans: Array<{ start: number; end: number }> } | null;
  displayPath?: string;
}

export interface SourceListItem {
  path: string;
  namespace: string;
  chunks: number;
  bytes: number;
  ingestedAt: number;
  documentId: string;
}

export interface HistoryItem {
  id: string;
  ts: number;
  query: string;
  answer: string;
  model: string;
  sources: Array<Source & { namespace?: string }>;
  tags?: string[];
  /** Custom user-set title; falls back to `query` when absent. */
  title?: string;
}

export interface FeedbackEntry {
  path: string;
  ups: number;
  downs: number;
  boost: number;
  updatedAt: number;
}

export interface NamespaceStats {
  namespace: string;
  files: number;
  chunks: number;
  bytes: number;
  oldestIngestedAt: number | null;
  newestIngestedAt: number | null;
  extensions: { ext: string; count: number }[];
}

export interface StatsReport {
  totals: { files: number; chunks: number; bytes: number; namespaces: number };
  byNamespace: NamespaceStats[];
  generatedAt: number;
}

export interface DigestSummary {
  savedSearchId: string;
  title: string;
  query: string;
  lastRunTs: number | null;
  lastNewCount: number;
  lastRemovedCount: number;
  runs: number;
}

export type CollectionColor = 'slate' | 'violet' | 'emerald' | 'amber' | 'rose' | 'sky';

export interface Collection {
  id: string;
  userId: string;
  name: string;
  description: string;
  color: CollectionColor;
  createdAt: number;
  updatedAt: number;
  itemCount?: number;
}

export interface SavedSearch {
  id: string;
  title: string;
  query: string;
  tags?: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface ShareSummary {
  id: string;
  createdAt: number;
  query: string;
  views: number;
  url: string;
  expiresAt: number | null;
  expired: boolean;
}

export interface PinEntry {
  path: string;
  note?: string;
  pinnedAt: number;
  pinnedBy: string;
}

export interface ConversationListItem {
  id: string;
  title: string;
  updatedAt: number;
  turns: number;
  archivedAt: number | null;
  snippet?: string | null;
  matchedTurn?: number | null;
}

export interface ConversationSearchResult {
  items: ConversationListItem[];
  total: number;
  limit: number;
  offset: number;
  q: string;
}

export interface ConversationTurn {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts?: number;
  sources?: Source[];
  model?: string;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number | null;
  turns: ConversationTurn[];
}

export interface UsageSummary {
  userId: string;
  period: string;
  used: number;
  limit: number;
  remaining: number;
  resetsAt: number;
  byKind: { ask: number; search: number };
  plan: 'free';
  workspace?: {
    period: string;
    used: number;
    limit: number | null;
    remaining: number | null;
    resetsAt: number;
    byKind: { ask: number; search: number };
    members: number;
  };
}

export interface WorkspaceQuotaPolicy {
  monthlyLimit: number | null;
  perUserMonthlyLimit: number | null;
  updatedAt: number;
  updatedBy: string | null;
}

export interface WorkspaceQuotaStatus {
  policy: WorkspaceQuotaPolicy;
  effective: { monthlyLimit: number | null; perUserMonthlyLimit: number | null };
  usage: {
    period: string;
    used: number;
    remaining: number | null;
    resetsAt: number;
    byKind: { ask: number; search: number };
    members: number;
  };
}

export type OnboardingStep = 'ingest' | 'ask' | 'configure';

export interface OnboardingRecord {
  userId: string;
  steps: Partial<Record<OnboardingStep, number>>;
  dismissed: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ProfileRecord {
  userId: string;
  displayName: string;
  timezone: string;
  defaultModel: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProfilePatch {
  displayName?: string;
  timezone?: string;
  defaultModel?: string | null;
}

export interface IpRule {
  cidr: string;
  label: string;
  createdAt: number;
}

export interface IpAllowlistRecord {
  userId: string;
  enabled: boolean;
  rules: IpRule[];
  updatedAt: number;
  createdAt: number;
}

export interface IpAllowlistLimits {
  maxRules: number;
  maxLabel: number;
}

export interface IpAllowlistInput {
  enabled: boolean;
  rules: Array<{ cidr: string; label?: string }>;
}

export interface WorkspaceIpAllowlistRecord {
  enabled: boolean;
  rules: IpRule[];
  updatedAt: number;
  createdAt: number;
  updatedBy: string | null;
}

export interface WorkspaceIpAllowlistInput {
  enabled: boolean;
  rules: Array<{ cidr: string; label?: string }>;
  confirmSelfLockoutAccepted?: boolean;
}

export interface SignInGeofenceRecord {
  enabled: boolean;
  mode: 'allow' | 'block';
  countries: string[];
  requireCountry: boolean;
  trustedHeaders: string[];
  createdAt: number;
  updatedAt: number;
  updatedBy: string | null;
}

export interface SignInGeofenceLimits {
  maxCountries: number;
  defaultHeaders: string[];
  countryFormat: string;
}

export interface SignInGeofenceInput {
  enabled: boolean;
  mode?: 'allow' | 'block';
  countries?: string[];
  requireCountry?: boolean;
  trustedHeaders?: string[];
  confirmSelfLockoutAccepted?: boolean;
}

export interface SignInGeofenceProbe {
  country: string | null;
  source: string | null;
  ip: string;
  wouldAllow: boolean;
  reason: string | null;
  usingHeaders: string[];
}

export interface OriginRule {
  origin: string;
  label: string;
  createdAt: number;
}

export interface WorkspaceOriginAllowlistRecord {
  enabled: boolean;
  rules: OriginRule[];
  updatedAt: number;
  createdAt: number;
  updatedBy: string | null;
}

export interface WorkspaceOriginAllowlistLimits {
  maxRules: number;
  maxLabel: number;
}

export interface WorkspaceOriginAllowlistInput {
  enabled: boolean;
  rules: Array<{ origin: string; label?: string }>;
}

export interface WebhookAllowedHost {
  host: string;
  label: string;
  createdAt: number;
}

export interface WebhookAllowlistRecord {
  userId: string;
  enabled: boolean;
  hosts: WebhookAllowedHost[];
  updatedAt: number;
  createdAt: number;
}

export interface WebhookAllowlistLimits {
  maxHosts: number;
  maxLabel: number;
  maxHostLen: number;
}

export interface WebhookAllowlistInput {
  enabled: boolean;
  hosts: Array<{ host: string; label?: string }>;
}

export interface WebhookEventsAllowlistRecord {
  userId: string;
  enabled: boolean;
  events: WebhookEvent[];
  createdAt: number;
  updatedAt: number;
}

export interface WebhookEventsAllowlistInput {
  enabled: boolean;
  events: WebhookEvent[];
}

export interface RetentionPolicy {
  userId: string;
  historyDays: number | null;
  conversationDays: number | null;
  auditDays: number | null;
  updatedAt: number;
  lastSweepAt: number | null;
}

export interface RetentionLimits {
  minDays: number;
  maxDays: number;
}

export interface LegalHold {
  workspaceId: string;
  active: boolean;
  reason: string | null;
  ticket: string | null;
  imposedBy: string | null;
  imposedAt: number | null;
  releasedBy: string | null;
  releasedAt: number | null;
  updatedAt: number;
}

export interface EncryptionStatus {
  schema: 'clawmind.encryption.v1';
  kekKind: 'internal' | 'customer';
  kekFingerprint: string;
  kekFingerprintShort: string;
  activeKeyId: string;
  activeKeyCreatedAt: number;
  activeKeyCreatedBy: string;
  archivedKeyCount: number;
  archivedKeys: Array<{
    keyId: string;
    createdAt: number;
    wrappedByKekKind: 'internal' | 'customer';
    wrappedByKekFingerprintShort: string;
  }>;
  version: number;
  updatedAt: number;
  updatedBy: string;
}

export interface WorkspaceFreeze {
  workspaceId: string;
  active: boolean;
  reason: string | null;
  ticket: string | null;
  frozenBy: string | null;
  frozenAt: number | null;
  releasedBy: string | null;
  releasedAt: number | null;
  updatedAt: number;
}

export interface VendorAccessPolicy {
  enabled: boolean;
  maxDurationSec: number;
  requireJustification: boolean;
  requireTicket: boolean;
  updatedAt: number;
  updatedBy: string | null;
}

export interface VendorAccessGrant {
  id: string;
  grantedBy: string;
  reason: string | null;
  ticket: string | null;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  revokedBy: string | null;
  lastUsedAt: number | null;
  useCount: number;
}

export type WorkspaceDeletionState = 'none' | 'pending' | 'cancelled' | 'completed';

export interface WorkspaceDeletion {
  workspaceId: string;
  state: WorkspaceDeletionState;
  reason: string | null;
  ticket: string | null;
  graceMs: number | null;
  scheduledAt: number | null;
  scheduledFor: number | null;
  scheduledBy: string | null;
  cancelledAt: number | null;
  cancelledBy: string | null;
  completedAt: number | null;
  completedBy: string | null;
  updatedAt: number;
}

export interface WorkspaceDeletionEnvelope {
  deletion: WorkspaceDeletion;
  pastDue: boolean;
  limits: { minGraceMs: number; defaultGraceMs: number; maxGraceMs: number };
}

export interface MfaPolicy {
  workspaceId: string;
  enforced: boolean;
  graceDays: number;
  enforcedAt: number | null;
  enforcedBy: string | null;
  disabledAt: number | null;
  disabledBy: string | null;
  updatedAt: number;
}

export interface MfaPolicyLimits {
  maxGraceDays: number;
  defaultGraceDays: number;
}

export interface SessionPolicy {
  workspaceId: string;
  maxLifetimeMinutes: number;
  idleTimeoutMinutes: number;
  maxConcurrentSessions: number;
  updatedAt: number;
  updatedBy: string | null;
}

export interface SessionPolicyLimits {
  maxLifetimeMinutes: number;
  maxIdleMinutes: number;
  maxConcurrentSessions: number;
  defaultLifetimeMinutes: number;
  defaultIdleMinutes: number;
}

export interface SharePolicy {
  workspaceId: string;
  disableShares: boolean;
  requireExpiry: boolean;
  maxTtlDays: number;
  updatedAt: number;
  updatedBy: string | null;
}

export interface SharePolicyLimits {
  maxTtlDays: number;
}

export interface ApiKeyPolicy {
  workspaceId: string;
  maxTtlMinutes: number;
  requireExpiry: boolean;
  maxActiveKeysPerUser: number;
  maxScopesPerKey: number;
  allowWildcardScope: boolean;
  forcedRotationDays: number;
  updatedAt: number;
  updatedBy: string | null;
}

export interface ApiKeyPolicyLimits {
  maxTtlMinutes: number;
  maxActiveKeysPerUser: number;
  maxScopesPerKey: number;
  maxForcedRotationDays: number;
}

export interface ApiKeyInactivityPolicy {
  workspaceId: string;
  idleDays: number;
  warnDays: number;
  updatedAt: number;
  updatedBy: string | null;
  lastSweepAt: number | null;
  lastSweepCount: number;
}

export interface ApiKeyInactivityLimits {
  maxIdleDays: number;
  maxWarnDays: number;
}

export interface ApiKeyInactivityAtRisk {
  id: string;
  userId: string;
  label: string;
  role: 'owner' | 'reader';
  createdAt: number;
  lastUsedAt: number | null;
  ageDays: number;
  status: 'warn' | 'expired';
  willRevokeAt: number | null;
}

export interface ApiKeyInactivitySweepResult {
  revokedIds: string[];
  scannedAt: number;
  dryRun: boolean;
}

export type Region = 'us' | 'eu' | 'uk' | 'ca' | 'au' | 'ap' | 'other';

export interface DataResidencyPolicy {
  workspaceId: string;
  allowedRegions: Region[];
  controller: string;
  updatedAt: number;
  updatedBy: string | null;
}

export interface DataResidencyResponse {
  policy: DataResidencyPolicy;
  serverRegion: Region;
  knownRegions: readonly Region[];
}

export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface MemberRecord {
  userId: string;
  role: MemberRole;
  email: string | null;
  label: string | null;
  invitedBy: string | null;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number | null;
}

export interface MemberInviteInput {
  userId: string;
  role: MemberRole;
  email?: string | null;
  label?: string | null;
}

export type ReviewDecision = 'pending' | 'keep' | 'downgrade' | 'revoke';
export type ReviewStatus = 'open' | 'closed';
export type ReviewAppliedAction =
  | 'none'
  | 'downgraded'
  | 'revoked'
  | 'skipped-missing'
  | 'skipped-last-owner';

export interface AccessReviewItem {
  userId: string;
  snapshotRole: MemberRole;
  email: string | null;
  label: string | null;
  snapshotLastSeenAt: number | null;
  decision: ReviewDecision;
  downgradeTo: MemberRole | null;
  note: string | null;
  decidedBy: string | null;
  decidedAt: number | null;
  appliedAction: ReviewAppliedAction | null;
  appliedError: string | null;
}

export interface AccessReview {
  id: string;
  title: string;
  status: ReviewStatus;
  openedBy: string;
  openedAt: number;
  closedBy: string | null;
  closedAt: number | null;
  attestation: string | null;
  items: AccessReviewItem[];
}

export interface AccessReviewSummary {
  total: number;
  open: number;
  closed: number;
  daysSinceLastClose: number | null;
}

export interface AccessReviewApplied {
  userId: string;
  action: ReviewAppliedAction;
  error: string | null;
}

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface InvitationRecord {
  id: string;
  email: string;
  role: MemberRole;
  label: string | null;
  invitedBy: string;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
  acceptedByUserId: string | null;
  revokedAt: number | null;
  revokedBy: string | null;
  status: InvitationStatus;
}

export interface InvitationCreateInput {
  email: string;
  role: MemberRole;
  label?: string | null;
  ttlMs?: number;
}

export interface InvitationCreateResponse {
  invitation: Pick<InvitationRecord, 'id' | 'email' | 'role' | 'label' | 'expiresAt' | 'createdAt' | 'status'>;
  token: string;
  acceptUrl: string;
}

export interface InvitationPeek {
  email: string;
  role: MemberRole;
  label: string | null;
  expiresAt: number;
  status: 'pending';
}

export interface RetentionPatch {
  historyDays?: number | null;
  conversationDays?: number | null;
  auditDays?: number | null;
}

export interface RetentionSweepReport {
  userId: string;
  dryRun: boolean;
  history: { removed: number; kept: number };
  conversations: { removed: number; kept: number; removedIds: string[] };
  auditDays: number | null;
}

export interface ActiveSession {
  id: string;
  userAgent: string;
  ip: string;
  createdAt: number;
  lastSeenAt: number;
  revokedAt?: number;
  current: boolean;
}

export interface SignInRecord {
  id: string;
  actor: string;
  method: string;
  outcome: 'success' | 'failure' | 'logout';
  ip: string;
  userAgent: string;
  reason?: string;
  at: number;
}

export interface SignInListResult {
  records: SignInRecord[];
  nextCursor: string | null;
  total: number;
}

export interface OnboardingProgress {
  completed: OnboardingStep[];
  next: OnboardingStep | null;
  total: number;
  done: number;
}

export interface ApiKey {
  id: string;
  userId: string;
  label: string;
  role: 'owner' | 'reader';
  scopes: string[] | null;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  rotatedAt?: number | null;
  previousHashExpiresAt?: number | null;
  rateLimit?: { max: number; windowMs: number } | null;
  allowedIps?: string[] | null;
  allowedOrigins?: string[] | null;
}

export interface KeyUsageEvent {
  ts: number;
  route: string;
  method: string;
  status: number;
  ms: number;
}

export interface KeyUsageReport {
  keyId: string;
  totals: {
    total: number;
    last24h: number;
    last7d: number;
    lastStatusOk: number;
    lastStatusErr: number;
    firstAt: number | null;
    lastAt: number | null;
  };
  recent: KeyUsageEvent[];
  byRoute: { route: string; method: string; count: number; lastAt: number }[];
}

export type WebhookEvent = 'ask.completed' | 'ingest.completed' | 'audit.event';

export interface Webhook {
  id: string;
  userId: string;
  url: string;
  events: WebhookEvent[];
  secret?: string; // only present in the create response
  // Set on a list response when a rotated secret is still inside its grace
  // window. The actual previousSecret value is never sent to the browser;
  // only the expiry so the UI can show a "old secret accepted until X" hint.
  previousSecretExpiresAt?: number;
  active: boolean;
  createdAt: number;
  lastDeliveryAt: number | null;
  lastStatus: number | null;
  failureCount: number;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  userId: string;
  event: WebhookEvent;
  ts: number;
  url: string;
  attempt: number;
  status: number | null;
  ok: boolean;
  error?: string;
  durationMs: number;
  payload?: unknown;
  parentId?: string;
}

// Build the /v1/history querystring once so list, response, and any future
// caller share normalisation rules (comma-separated arrays, omitted blanks).
function historyResponse(
  params: { q?: string; namespaces?: string[]; tags?: string[]; since?: number; until?: number; limit?: number },
): Promise<{ items: HistoryItem[]; total: number; availableTags?: string[] }> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.namespaces && params.namespaces.length) qs.set('namespaces', params.namespaces.join(','));
  if (params.tags && params.tags.length) qs.set('tags', params.tags.join(','));
  if (params.since !== undefined) qs.set('since', String(params.since));
  if (params.until !== undefined) qs.set('until', String(params.until));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  const q = qs.toString();
  return j<{ items: HistoryItem[]; total: number; availableTags?: string[] }>(
    `/v1/history${q ? `?${q}` : ''}`,
  );
}

export const api = {
  health: () =>
    j<{ ok: boolean; embed: boolean; llm: boolean; docs: number; chunks: number }>('/health'),

  ssoConfig: () =>
    j<{
      enabled: boolean;
      enforced: boolean;
      issuer: string | null;
      clientId: string | null;
      redirectUri: string | null;
      allowedDomains: string[];
      scopes: string | null;
      mode: 'single-user' | 'github' | 'oidc';
    }>('/auth/sso/config'),

  // Search and ask
  search: (body: {
    q: string;
    k?: number;
    namespaces?: string[];
    includeTags?: string[];
    excludeTags?: string[];
    highlight?: boolean;
    snippetWidth?: number;
  }) =>
    j<{ hits: Source[] }>('/v1/search', { method: 'POST', body: JSON.stringify(body) }),
  ask: (body: { q: string; k?: number; namespaces?: string[] }) =>
    j<{ id: string; text: string; sources: Source[] }>('/v1/ask', { method: 'POST', body: JSON.stringify(body) }),
  askBatch: (queries: string[], opts: { namespaces?: string[]; k?: number } = {}) =>
    j<{
      id: string;
      total: number;
      ok: number;
      failed: number;
      results: Array<{
        q: string;
        tag?: string;
        ok: boolean;
        answer?: string;
        model?: string;
        sources?: number;
        error?: string;
        durationMs: number;
      }>;
    }>('/v1/ask/batch', { method: 'POST', body: JSON.stringify({ queries, ...opts }) }),
  stream: (
    body: { q: string; k?: number; namespaces?: string[] },
    onEvent: (e: { type: string; value: unknown }) => void,
  ) => streamPost(`${BASE}/v1/ask/stream`, body, onEvent),
  explain: (body: { q: string; k?: number; namespaces?: string[]; hybridAlpha?: number; mmrLambda?: number }) =>
    j<ExplainResponse>('/v1/explain', { method: 'POST', body: JSON.stringify(body) }),

  // History and saved
  history: (
    params: { q?: string; namespaces?: string[]; tags?: string[]; since?: number; until?: number; limit?: number } = {},
  ) => historyResponse(params).then((r) => r.items),
  historyResponse: (
    params: { q?: string; namespaces?: string[]; tags?: string[]; since?: number; until?: number; limit?: number } = {},
  ) => historyResponse(params),
  removeHistoryItem: (id: string) =>
    j<{ id: string; deleted: boolean }>(`/v1/history/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  renameHistoryItem: (id: string, title: string) =>
    j<{ id: string; title: string }>(`/v1/history/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),
  setHistoryTags: (id: string, tags: string[]) =>
    j<{ id: string; tags: string[] }>(`/v1/history/${encodeURIComponent(id)}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tags }),
    }),
  addHistoryTags: (id: string, tags: string[]) =>
    j<{ id: string; tags: string[] }>(`/v1/history/${encodeURIComponent(id)}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tags }),
    }),
  removeHistoryTags: (id: string, tags: string[]) =>
    j<{ id: string; tags: string[] }>(`/v1/history/${encodeURIComponent(id)}/tags`, {
      method: 'DELETE',
      body: JSON.stringify({ tags }),
    }),
  savedList: () => j<{ items: SavedSearch[] }>('/v1/saved').then((r) => r.items),
  saveSearch: (input: { title: string; query: string; tags?: string[] }) =>
    j<{ item: SavedSearch }>('/v1/saved', { method: 'POST', body: JSON.stringify(input) }).then((r) => r.item),
  updateSaved: (id: string, patch: { title?: string; query?: string; tags?: string[] }) =>
    j<{ item: SavedSearch }>(`/v1/saved/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then((r) => r.item),
  removeSaved: (id: string) => j<void>(`/v1/saved/${id}`, { method: 'DELETE' }),

  // Collections: group saved searches under a named folder. The membership
  // mapping is fetched separately so the saved-searches view can render chips
  // without N+1 round trips.
  collectionsList: () =>
    j<{ items: Collection[] }>('/v1/collections').then((r) => r.items),
  collectionsMembership: () =>
    j<{ membership: Record<string, string[]> }>('/v1/collections/_membership').then((r) => r.membership),
  collectionGet: (id: string) =>
    j<{ collection: Collection; items: SavedSearch[] }>(`/v1/collections/${encodeURIComponent(id)}`),
  collectionCreate: (input: { name: string; description?: string; color?: CollectionColor }) =>
    j<{ item: Collection }>('/v1/collections', { method: 'POST', body: JSON.stringify(input) }).then((r) => r.item),
  collectionUpdate: (id: string, patch: { name?: string; description?: string; color?: CollectionColor }) =>
    j<{ item: Collection }>(`/v1/collections/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }).then((r) => r.item),
  collectionDelete: (id: string) =>
    j<{ ok: boolean }>(`/v1/collections/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  collectionAddMember: (id: string, savedId: string) =>
    j<{ ok: boolean; added: boolean }>(`/v1/collections/${encodeURIComponent(id)}/members`, {
      method: 'POST',
      body: JSON.stringify({ savedId }),
    }),
  collectionRemoveMember: (id: string, savedId: string) =>
    j<{ ok: boolean; removed: boolean }>(
      `/v1/collections/${encodeURIComponent(id)}/members/${encodeURIComponent(savedId)}`,
      { method: 'DELETE' },
    ),
  collectionSetMembers: (id: string, savedIds: string[]) =>
    j<{ savedIds: string[] }>(`/v1/collections/${encodeURIComponent(id)}/members`, {
      method: 'PUT',
      body: JSON.stringify({ savedIds }),
    }).then((r) => r.savedIds),
  share: (id: string) => j<{ id: string; query: string; answer: string; sources?: Source[]; createdAt?: number; views?: number }>(`/v1/share/${id}`),
  createShare: (input: { query: string; answer: string; sources: Source[]; ttlDays?: number | null }) =>
    j<{ id: string; url: string; expiresAt: number | null }>('/v1/share', { method: 'POST', body: JSON.stringify(input) }),
  listShares: () =>
    j<{ items: ShareSummary[] }>('/v1/shares').then((r) => r.items),
  deleteShare: (id: string) =>
    j<{ id: string; deleted: boolean }>(`/v1/share/${id}`, { method: 'DELETE' }),

  // Stats
  stats: () => j<StatsReport>('/v1/stats'),

  // Sources
  sourcesList: (params: { q?: string; namespace?: string; limit?: number; offset?: number; sort?: 'recent' | 'path' | 'chunks' } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.namespace) qs.set('namespace', params.namespace);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    if (params.sort) qs.set('sort', params.sort);
    const q = qs.toString();
    return j<{ total: number; offset: number; limit: number; items: SourceListItem[] }>(
      `/v1/sources${q ? `?${q}` : ''}`,
    );
  },
  sourceFile: (path: string, start?: number, end?: number) => {
    const qs = new URLSearchParams({ path });
    if (start) qs.set('start', String(start));
    if (end) qs.set('end', String(end));
    return j<{ path: string; start: number; end: number; content: string }>(`/v1/sources/file?${qs}`);
  },

  // Feedback
  feedbackList: () => j<{ items: FeedbackEntry[] }>('/v1/feedback').then((r) => r.items),
  feedbackVote: (path: string, vote: 1 | -1) =>
    j<{ path: string; ups: number; downs: number; boost: number }>('/v1/feedback', {
      method: 'POST',
      body: JSON.stringify({ path, vote }),
    }),
  feedbackClear: (path: string) =>
    j<{ ok: boolean }>('/v1/feedback', { method: 'DELETE', body: JSON.stringify({ path }) }),

  // Ingest
  ingest: (root: string, watch = false) =>
    j<{ ok: boolean; added: number; updated: number; removed: number; corpusVersion: number }>(
      '/v1/ingest',
      { method: 'POST', body: JSON.stringify({ root, watch }) },
    ),
  ingestStatus: () =>
    j<{ documents: number; chunks: number; bm25: number }>('/v1/ingest/status'),

  // Digests
  digests: () => j<{ items: DigestSummary[] }>('/v1/digests').then((r) => r.items),
  digestRun: (id: string, k = 8) =>
    j<{ entry: { newSources: string[]; removedSources: string[]; runTs: number }; lastRunTs: number; totalRuns: number }>(
      `/v1/digests/${id}/run`,
      { method: 'POST', body: JSON.stringify({ k }) },
    ),
  digestDetail: (id: string) =>
    j<{ state: { savedSearchId: string; lastRunTs: number; history: { runTs: number; topSources: string[]; newSources: string[]; removedSources: string[] }[] } }>(
      `/v1/digests/${id}`,
    ),

  // Pins
  pinsList: () => j<{ items: PinEntry[]; count: number }>('/v1/pins').then((r) => r.items),
  pinAdd: (path: string, note?: string) =>
    j<PinEntry>('/v1/pins', { method: 'POST', body: JSON.stringify({ path, note }) }),
  pinRemove: (path: string) =>
    j<{ ok: boolean }>('/v1/pins', { method: 'DELETE', body: JSON.stringify({ path }) }),

  // API keys
  keysList: () => j<{ items: ApiKey[] }>('/v1/keys').then((r) => r.items),
  keyIssue: (input: { label: string; role?: 'owner' | 'reader'; scopes?: string[]; ttlMs?: number | null }) =>
    j<{ key: ApiKey; secret: string }>('/v1/keys', { method: 'POST', body: JSON.stringify(input) }),
  keyRevoke: (id: string) => j<{ ok: boolean }>(`/v1/keys/${id}`, { method: 'DELETE' }),
  keyRotate: (id: string) =>
    j<{ key: ApiKey; secret: string; previousExpiresAt: number | null }>(
      `/v1/keys/${id}/rotate`,
      { method: 'POST' },
    ),
  keySetRateLimit: (id: string, rateLimit: { max: number; windowMs: number } | null) =>
    j<{ key: ApiKey }>(
      `/v1/keys/${id}/rate-limit`,
      { method: 'PUT', body: JSON.stringify({ rateLimit }) },
    ).then((r) => r.key),
  keySetAllowedIps: (id: string, allowedIps: string[] | null) =>
    j<{ key: ApiKey }>(
      `/v1/keys/${id}/ip-allowlist`,
      { method: 'PUT', body: JSON.stringify({ allowedIps }) },
    ).then((r) => r.key),
  keySetAllowedOrigins: (id: string, allowedOrigins: string[] | null) =>
    j<{ key: ApiKey }>(
      `/v1/keys/${id}/origin-allowlist`,
      { method: 'PUT', body: JSON.stringify({ allowedOrigins }) },
    ).then((r) => r.key),
  keyUsage: (id: string, opts: { recent?: number; routes?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.recent) q.set('recent', String(opts.recent));
    if (opts.routes) q.set('routes', String(opts.routes));
    const qs = q.toString();
    return j<KeyUsageReport>(`/v1/keys/${id}/usage${qs ? `?${qs}` : ''}`);
  },

  // Usage and quota
  usage: () => j<UsageSummary>('/v1/usage'),
  profileGet: () => j<{ profile: ProfileRecord }>('/v1/me').then((r) => r.profile),
  profilePatch: (patch: ProfilePatch) =>
    j<{ profile: ProfileRecord }>('/v1/me', { method: 'PATCH', body: JSON.stringify(patch) }).then((r) => r.profile),

  // Per-user IP allowlist. When enabled, only requests from one of the
  // listed CIDR blocks reach the API for this user; the management
  // endpoint itself is always reachable so a typo cannot lock the user
  // out of their own controls.
  ipAllowlistGet: () =>
    j<{ record: IpAllowlistRecord; limits: IpAllowlistLimits }>('/v1/ip-allowlist'),
  ipAllowlistPut: (input: IpAllowlistInput) =>
    j<{ record: IpAllowlistRecord }>('/v1/ip-allowlist', {
      method: 'PUT',
      body: JSON.stringify(input),
    }).then((r) => r.record),

  // Workspace-wide IP allowlist. When enabled, every authenticated
  // request from every member (session or API key) must come from one
  // of the listed CIDR blocks. Get is gated by ip-allowlist:read; Put
  // is owner-only with MFA. The management endpoint is itself never
  // gated, so an owner can always recover from a bad rule.
  workspaceIpAllowlistGet: () =>
    j<{ record: WorkspaceIpAllowlistRecord; limits: IpAllowlistLimits }>(
      '/v1/workspace-ip-allowlist',
    ),
  workspaceIpAllowlistPut: (input: WorkspaceIpAllowlistInput) =>
    j<{ record: WorkspaceIpAllowlistRecord }>('/v1/workspace-ip-allowlist', {
      method: 'PUT',
      body: JSON.stringify(input),
    }).then((r) => r.record),

  // Sign-in geofence. Workspace owners declare an ISO 3166 country
  // allow/block list that gates the GitHub and OIDC sign-in callbacks.
  // Get/probe are owner-only; Put is owner-only with MFA step-up. The
  // management endpoints are intentionally never gated by the policy
  // itself so an owner whose region was blocked can still log in via
  // an alternate path (API key) and adjust.
  signInGeofenceGet: () =>
    j<{ record: SignInGeofenceRecord; limits: SignInGeofenceLimits }>(
      '/v1/sign-in-geofence',
    ),
  signInGeofenceProbe: () =>
    j<SignInGeofenceProbe>('/v1/sign-in-geofence/probe'),
  signInGeofencePut: (input: SignInGeofenceInput) =>
    j<{ record: SignInGeofenceRecord }>('/v1/sign-in-geofence', {
      method: 'PUT',
      body: JSON.stringify(input),
    }).then((r) => r.record),

  // Workspace-wide browser Origin (CORS) allowlist. Read is admins+;
  // Put is owner-only with MFA step-up. Additive to the static
  // CLAWMIND_API_CORS_ORIGIN env baseline.
  workspaceOriginAllowlistGet: () =>
    j<{ record: WorkspaceOriginAllowlistRecord; limits: WorkspaceOriginAllowlistLimits }>(
      '/v1/workspace-origin-allowlist',
    ),
  workspaceOriginAllowlistPut: (input: WorkspaceOriginAllowlistInput) =>
    j<{ record: WorkspaceOriginAllowlistRecord }>('/v1/workspace-origin-allowlist', {
      method: 'PUT',
      body: JSON.stringify(input),
    }).then((r) => r.record),

  // Workspace-managed outbound webhook destination allowlist. When
  // enabled, every webhook URL (at registration, update, and on every
  // delivery attempt) must match an allowed host pattern. Get is
  // admins+; Put is owner-only with MFA step-up.
  webhookAllowlistGet: () =>
    j<{ record: WebhookAllowlistRecord; limits: WebhookAllowlistLimits }>(
      '/v1/webhook-allowlist',
    ),
  webhookAllowlistPut: (input: WebhookAllowlistInput) =>
    j<{ record: WebhookAllowlistRecord }>('/v1/webhook-allowlist', {
      method: 'PUT',
      body: JSON.stringify(input),
    }).then((r) => r.record),

  // Workspace-managed webhook *event-type* allowlist. Companion to the
  // destination allowlist above: this restricts which event subjects
  // (e.g. ask.completed) may be subscribed to at all. Get is admins+;
  // Put is owner-only with MFA step-up.
  webhookEventsAllowlistGet: () =>
    j<{ record: WebhookEventsAllowlistRecord; events: WebhookEvent[] }>(
      '/v1/webhook-events-allowlist',
    ),
  webhookEventsAllowlistPut: (input: WebhookEventsAllowlistInput) =>
    j<{ record: WebhookEventsAllowlistRecord; events: WebhookEvent[] }>(
      '/v1/webhook-events-allowlist',
      {
        method: 'PUT',
        body: JSON.stringify(input),
      },
    ).then((r) => r.record),

  // Active sessions for the current user. The UI surfaces "where am I
  // signed in" plus per-session and revoke-all buttons; revocation is
  // enforced by the API auth preHandler on the next request from that sid.
  sessionsList: () =>
    j<{ sessions: ActiveSession[] }>('/v1/sessions').then((r) => r.sessions),
  sessionsRevoke: (id: string) =>
    j<{ revoked: number }>(`/v1/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  sessionsRevokeAll: (keepCurrent: boolean) =>
    j<{ revoked: number }>('/v1/sessions/revoke-all', {
      method: 'POST',
      body: JSON.stringify({ keepCurrent }),
    }),

  // Sign-in activity log. The self-view paginates newest-first; the admin
  // view exposes failed attempts and probes that did not resolve to a
  // user. Both share the same response shape.
  signInLogList: (params: { outcome?: 'success' | 'failure' | 'logout'; method?: string; limit?: number; cursor?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.outcome) q.set('outcome', params.outcome);
    if (params.method) q.set('method', params.method);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.cursor) q.set('cursor', params.cursor);
    const qs = q.toString();
    return j<SignInListResult>(`/v1/sign-in-log${qs ? `?${qs}` : ''}`);
  },
  signInLogListAll: (params: { outcome?: 'success' | 'failure' | 'logout'; method?: string; actor?: string; limit?: number; cursor?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.outcome) q.set('outcome', params.outcome);
    if (params.method) q.set('method', params.method);
    if (params.actor) q.set('actor', params.actor);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.cursor) q.set('cursor', params.cursor);
    const qs = q.toString();
    return j<SignInListResult>(`/v1/sign-in-log/all${qs ? `?${qs}` : ''}`);
  },

  // Workspace members and RBAC. The 4-role hierarchy is enforced server
  // side; the UI surfaces who has access, who invited them, and lets an
  // owner promote/demote/remove with MFA step-up.
  membersList: () =>
    j<{ members: MemberRecord[] }>('/v1/members').then((r) => r.members),
  membersInvite: (input: MemberInviteInput) =>
    j<{ created: boolean; member: MemberRecord }>('/v1/members', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  membersSetRole: (userId: string, role: MemberRole) =>
    j<{ member: MemberRecord }>(`/v1/members/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }).then((r) => r.member),
  membersRemove: (userId: string) =>
    j<{ removed: MemberRecord; offboarding: { keysRevoked: number; sessionsRevoked: number; keyIds: string[] } }>(
      `/v1/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    ),

  // Offboarding cleanup. Surface API keys whose owning userId is no
  // longer a workspace member (historical orphans), and let an owner
  // revoke them. New removals sweep keys + sessions atomically so this
  // list should normally stay empty.
  offboardingOrphans: () =>
    j<{ count: number; orphans: Array<{ id: string; userId: string; label: string; role: 'owner' | 'reader'; createdAt: number; lastUsedAt: number | null; expiresAt: number | null }> }>(
      '/v1/offboarding/orphans',
    ),
  offboardingRevokeOrphan: (id: string) =>
    j<{ ok: boolean; id: string }>(`/v1/offboarding/orphans/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
    }),

  // Periodic access reviews (SOC2 CC6.3). Owners open a campaign,
  // walk every member, mark keep / downgrade / revoke, then close to
  // apply changes and produce an attested recertification record.
  accessReviewsList: () =>
    j<{ reviews: AccessReview[] }>('/v1/access-reviews').then((r) => r.reviews),
  accessReviewsSummary: () =>
    j<AccessReviewSummary>('/v1/access-reviews/summary'),
  accessReviewsGet: (id: string) =>
    j<{ review: AccessReview }>(`/v1/access-reviews/${encodeURIComponent(id)}`).then((r) => r.review),
  accessReviewsOpen: (title: string) =>
    j<{ review: AccessReview }>('/v1/access-reviews', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }).then((r) => r.review),
  accessReviewsDecide: (
    id: string,
    userId: string,
    input: { decision: 'keep' | 'downgrade' | 'revoke'; downgradeTo?: MemberRole | null; note?: string | null },
  ) =>
    j<{ review: AccessReview }>(
      `/v1/access-reviews/${encodeURIComponent(id)}/decisions/${encodeURIComponent(userId)}`,
      { method: 'POST', body: JSON.stringify(input) },
    ).then((r) => r.review),
  accessReviewsClose: (id: string, attestation: string | null) =>
    j<{ review: AccessReview; applied: AccessReviewApplied[] }>(
      `/v1/access-reviews/${encodeURIComponent(id)}/close`,
      { method: 'POST', body: JSON.stringify({ attestation }) },
    ),

  // Email-token invitations. createInvitation returns the raw token
  // exactly once. The server stores only sha256(token); a leaked
  // invitations.json file cannot be used to walk in through a pending
  // link.
  invitationsList: () =>
    j<{ invitations: InvitationRecord[] }>('/v1/invitations').then((r) => r.invitations),
  invitationsCreate: (input: InvitationCreateInput) =>
    j<InvitationCreateResponse>('/v1/invitations', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  invitationsRevoke: (id: string) =>
    j<{ invitation: InvitationRecord }>(`/v1/invitations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }).then((r) => r.invitation),
  invitationsPeek: (token: string) =>
    j<{ invitation: InvitationPeek }>(
      `/v1/invitations/peek?token=${encodeURIComponent(token)}`,
    ).then((r) => r.invitation),
  invitationsAccept: (token: string) =>
    j<{ invitation: InvitationRecord; assignedRole: MemberRole }>(
      '/v1/invitations/accept',
      { method: 'POST', body: JSON.stringify({ token }) },
    ),

  // Per-user data retention policy. Lets a customer cap how long
  // ClawMind keeps their history and conversations before auto-erasing.
  // Used by /settings/data for the GDPR/CCPA review story.
  retentionGet: () =>
    j<{ policy: RetentionPolicy; limits: RetentionLimits }>('/v1/retention'),
  retentionPut: (patch: RetentionPatch) =>
    j<{ policy: RetentionPolicy }>('/v1/retention', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }).then((r) => r.policy),
  retentionApply: (dryRun: boolean) =>
    j<{ report: RetentionSweepReport }>(
      `/v1/retention/apply${dryRun ? '?dry_run=true' : ''}`,
      { method: 'POST' },
    ).then((r) => r.report),

  // Workspace-wide monthly request quota. Admin-readable so finance can
  // confirm the configured cap; owner-only to change with MFA step-up.
  workspaceQuotaGet: () => j<WorkspaceQuotaStatus>('/v1/workspace-quota'),
  workspaceQuotaPut: (patch: {
    monthlyLimit?: number | null;
    perUserMonthlyLimit?: number | null;
  }) =>
    j<WorkspaceQuotaPolicy>('/v1/workspace-quota', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  // Workspace-wide legal hold. When active, blocks user-initiated
  // data deletion and scheduled retention sweeps. Read is admin+,
  // mutations are owner-only with MFA step-up.
  legalHoldGet: () => j<{ hold: LegalHold }>('/v1/legal-hold').then((r) => r.hold),
  legalHoldImpose: (input: { reason?: string | null; ticket?: string | null }) =>
    j<{ hold: LegalHold }>('/v1/legal-hold', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((r) => r.hold),
  legalHoldRelease: () =>
    j<{ hold: LegalHold }>('/v1/legal-hold', { method: 'DELETE' }).then((r) => r.hold),

  // Workspace encryption keys (CMEK / BYOK). The status surface is
  // read-only for admins and never echoes wrapped key material; only
  // the active KEK kind, short fingerprint, active key id, and the
  // small archived-key roll are exposed. Mutations are owner-only and
  // require a recent MFA step-up at the route layer.
  encryptionGet: () =>
    j<{ encryption: EncryptionStatus }>('/v1/encryption').then((r) => r.encryption),
  encryptionUploadKek: (kek: string) =>
    j<{ encryption: EncryptionStatus }>('/v1/encryption/kek', {
      method: 'POST',
      body: JSON.stringify({ kek }),
    }).then((r) => r.encryption),
  encryptionRemoveKek: (kek: string) =>
    j<{ encryption: EncryptionStatus }>('/v1/encryption/kek', {
      method: 'DELETE',
      body: JSON.stringify({ kek }),
    }).then((r) => r.encryption),
  encryptionRotate: (kek?: string) =>
    j<{ encryption: EncryptionStatus }>('/v1/encryption/rotate', {
      method: 'POST',
      body: JSON.stringify(kek ? { kek } : {}),
    }).then((r) => r.encryption),

  // Workspace freeze (kill switch). When active, every mutating route
  // outside the auth / MFA / export / freeze-management allowlist returns
  // 423 Locked. Reads, exports, and the freeze endpoint itself remain
  // available so customers can still pull data and owners can unfreeze.
  workspaceFreezeGet: () =>
    j<{ freeze: WorkspaceFreeze }>('/v1/workspace/freeze').then((r) => r.freeze),
  workspaceFreezeActivate: (input: { reason?: string | null; ticket?: string | null }) =>
    j<{ freeze: WorkspaceFreeze }>('/v1/workspace/freeze', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((r) => r.freeze),
  workspaceFreezeRelease: () =>
    j<{ freeze: WorkspaceFreeze }>('/v1/workspace/freeze', { method: 'DELETE' }).then((r) => r.freeze),

  // Vendor Support Access Lockbox. Default-closed control that lets a
  // workspace owner mint a time-bound, audited token a vendor support
  // engineer can present via X-Vendor-Support-Token. Every API response
  // carries X-Vendor-Access-Lockbox so monitoring can verify the door
  // is shut.
  vendorAccessGet: () =>
    j<{
      policy: VendorAccessPolicy;
      current: VendorAccessGrant | null;
      history: VendorAccessGrant[];
    }>('/v1/workspace/vendor-access'),
  vendorAccessUpdatePolicy: (input: Partial<VendorAccessPolicy>) =>
    j<{ policy: VendorAccessPolicy }>('/v1/workspace/vendor-access/policy', {
      method: 'PUT',
      body: JSON.stringify(input),
    }).then((r) => r.policy),
  vendorAccessGrant: (input: { durationSec: number; reason?: string | null; ticket?: string | null }) =>
    j<{ grant: VendorAccessGrant; token: string }>(
      '/v1/workspace/vendor-access/grants',
      { method: 'POST', body: JSON.stringify(input) },
    ),
  vendorAccessRevoke: () =>
    j<{ grant: VendorAccessGrant | null }>(
      '/v1/workspace/vendor-access/grants/current',
      { method: 'DELETE' },
    ).then((r) => r.grant),

  // Workspace scheduled deletion (GDPR right to erasure, tenant level).
  // Schedules a hard wipe N days out (default 7, clamped to [1h, 90d]).
  // While pending, every mutating endpoint outside the allowlist returns
  // 423 so no new state accrues during the wind-down. Owner-only with
  // MFA step-up at the route. Cancel before scheduledFor to abort.
  workspaceDeletionGet: () =>
    j<WorkspaceDeletionEnvelope>('/v1/workspace/deletion'),
  workspaceDeletionSchedule: (input: {
    reason?: string | null;
    ticket?: string | null;
    graceMs?: number | null;
  }) =>
    j<WorkspaceDeletionEnvelope>('/v1/workspace/deletion', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  workspaceDeletionCancel: () =>
    j<WorkspaceDeletionEnvelope>('/v1/workspace/deletion', { method: 'DELETE' }),
  workspaceDeletionComplete: () =>
    j<WorkspaceDeletionEnvelope>('/v1/workspace/deletion/complete', { method: 'POST' }),

  // Workspace MFA enforcement policy. When enforced, every signed-in
  // human must enrol TOTP MFA before any mutating endpoint will accept
  // their session; the grace window gives existing users time to enrol
  // after the policy is flipped on. API-key callers are exempt.
  mfaPolicyGet: () =>
    j<{ policy: MfaPolicy; limits: MfaPolicyLimits }>('/v1/mfa-policy'),
  mfaPolicyEnable: (input: { graceDays?: number }) =>
    j<{ policy: MfaPolicy }>('/v1/mfa-policy', {
      method: 'PUT',
      body: JSON.stringify({ enforced: true, ...input }),
    }).then((r) => r.policy),
  mfaPolicyDisable: () =>
    j<{ policy: MfaPolicy }>('/v1/mfa-policy', { method: 'DELETE' }).then((r) => r.policy),

  sessionPolicyGet: () =>
    j<{ policy: SessionPolicy; limits: SessionPolicyLimits }>('/v1/session-policy'),
  sessionPolicySet: (input: { maxLifetimeMinutes?: number; idleTimeoutMinutes?: number; maxConcurrentSessions?: number }) =>
    j<{ policy: SessionPolicy }>('/v1/session-policy', {
      method: 'PUT',
      body: JSON.stringify(input),
    }).then((r) => r.policy),

  sharePolicyGet: () =>
    j<{ policy: SharePolicy; limits: SharePolicyLimits }>('/v1/share-policy'),
  sharePolicySet: (input: { disableShares?: boolean; requireExpiry?: boolean; maxTtlDays?: number }) =>
    j<{ policy: SharePolicy }>('/v1/share-policy', {
      method: 'PUT',
      body: JSON.stringify(input),
    }).then((r) => r.policy),

  apiKeyPolicyGet: () =>
    j<{ policy: ApiKeyPolicy; limits: ApiKeyPolicyLimits }>('/v1/api-key-policy'),
  apiKeyPolicySet: (input: Partial<Omit<ApiKeyPolicy, 'workspaceId' | 'updatedAt' | 'updatedBy'>>) =>
    j<{ policy: ApiKeyPolicy }>('/v1/api-key-policy', {
      method: 'PUT',
      body: JSON.stringify(input),
    }).then((r) => r.policy),

  apiKeyInactivityGet: () =>
    j<{
      policy: ApiKeyInactivityPolicy;
      limits: ApiKeyInactivityLimits;
      counts: { activeKeys: number; warnKeys: number; expiredKeys: number };
    }>('/v1/api-key-inactivity'),
  apiKeyInactivitySet: (input: { idleDays?: number; warnDays?: number }) =>
    j<{ policy: ApiKeyInactivityPolicy }>('/v1/api-key-inactivity', {
      method: 'PUT',
      body: JSON.stringify(input),
    }).then((r) => r.policy),
  apiKeyInactivityAtRisk: () =>
    j<{ policy: ApiKeyInactivityPolicy; atRisk: ApiKeyInactivityAtRisk[] }>(
      '/v1/api-key-inactivity/at-risk',
    ),
  apiKeyInactivitySweep: (input: { dryRun?: boolean } = {}) =>
    j<ApiKeyInactivitySweepResult>('/v1/api-key-inactivity/sweep', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // Workspace data residency. GET returns the policy plus the current
  // server region so the admin page can show whether the connected
  // process is itself compliant with the configured allow-list.
  dataResidencyGet: () =>
    j<DataResidencyResponse>('/v1/data-residency'),
  dataResidencySet: (input: { allowedRegions: Region[]; controller: string }) =>
    j<DataResidencyResponse>('/v1/data-residency', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  // Multi-factor auth. The /settings/mfa page walks the user through
  // enrollment (start, scan, confirm) and surfaces step-up state for
  // sensitive routes like key issuance and data deletion.
  mfaStatus: () =>
    j<{
      enrolled: boolean;
      confirmed: boolean;
      createdAt: number | null;
      confirmedAt: number | null;
      recoveryCodesRemaining: number;
      stepUpTtlSec: number;
      sessionStepUpActive: boolean;
      sessionVerifiedAt: number | null;
    }>('/v1/mfa/status'),
  mfaEnroll: () =>
    j<{ secret: string; otpauthUrl: string; recoveryCodes: string[] }>(
      '/v1/mfa/enroll',
      { method: 'POST', body: JSON.stringify({}) },
    ),
  mfaConfirm: (code: string) =>
    j<{ ok: true }>('/v1/mfa/confirm', { method: 'POST', body: JSON.stringify({ code }) }),
  mfaVerify: (
    code: string,
    opts: { rememberDevice?: boolean; deviceLabel?: string; trustDays?: number } = {},
  ) =>
    j<{
      ok: true;
      method: 'totp' | 'recovery';
      recoveryCodesRemaining: number;
      stepUpExpiresAt: number;
      trustedDevice?: { id: string; expiresAt: number; trustDays: number };
    }>('/v1/mfa/verify', {
      method: 'POST',
      body: JSON.stringify({ code, ...opts }),
    }),
  mfaTrustedDevices: () =>
    j<{
      devices: Array<{
        id: string;
        label: string;
        ip: string;
        userAgent: string;
        createdAt: number;
        lastSeenAt: number;
        expiresAt: number;
      }>;
      currentDeviceId: string | null;
    }>('/v1/mfa/trusted-devices'),
  mfaRevokeTrustedDevice: (id: string) =>
    j<{ ok: true; revokedId: string }>(`/v1/mfa/trusted-devices/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  mfaRevokeAllTrustedDevices: () =>
    j<{ ok: true; revokedCount: number }>('/v1/mfa/trusted-devices', { method: 'DELETE' }),
  mfaRegenerateRecovery: (code: string) =>
    j<{ recoveryCodes: string[] }>('/v1/mfa/recovery/regenerate', {
      method: 'POST', body: JSON.stringify({ code }),
    }),
  mfaDisable: (code: string) =>
    j<{ ok: true }>('/v1/mfa', { method: 'DELETE', body: JSON.stringify({ code }) }),

  // Onboarding (per-user first-run state). The /welcome page reads the
  // current record on mount and writes step completions as the user
  // moves through ingest -> ask -> configure.
  onboarding: () =>
    j<{ record: OnboardingRecord; progress: OnboardingProgress }>('/v1/onboarding'),
  onboardingComplete: (step: OnboardingStep) =>
    j<{ record: OnboardingRecord; progress: OnboardingProgress }>(
      '/v1/onboarding/complete',
      { method: 'POST', body: JSON.stringify({ step }) },
    ),
  onboardingDismiss: () =>
    j<{ record: OnboardingRecord; progress: OnboardingProgress }>(
      '/v1/onboarding/dismiss',
      { method: 'POST' },
    ),
  onboardingReset: () =>
    j<{ record: OnboardingRecord; progress: OnboardingProgress }>(
      '/v1/onboarding/reset',
      { method: 'POST' },
    ),

  // Account lifecycle (GDPR). Exports every per-user record as JSON or
  // erases them. Both are audit-logged on the server. The web client
  // surfaces the export as a file download and the delete behind an
  // explicit type-to-confirm prompt.
  meExportUrl: () => `${BASE}/v1/me/export`,
  meExportZipUrl: () => `${BASE}/v1/me/export.zip`,

  // Tenant-wide export. Owner-only on the server; the page hides itself for
  // non-owners using `me()` role. URLs are surfaced so the browser can stream
  // the download directly instead of buffering through fetch().
  workspaceExportJsonUrl: () => `${BASE}/v1/workspace/export.json`,
  workspaceExportZipUrl: () => `${BASE}/v1/workspace/export.zip`,
  workspaceExportPreview: () =>
    j<{
      schema: 'clawmind.workspace-export-preview.v1';
      dryRun: true;
      previewedAt: number;
      estimatedBytes: number;
      counts: Record<string, number>;
    }>('/v1/workspace/export/preview'),
  meDeleteData: () =>
    j<{ userId: string; deletedAt: number; removed: Record<string, number> }>(
      '/v1/me/data',
      { method: 'DELETE', body: JSON.stringify({ confirm: 'DELETE' }) },
    ),
  // Sandbox preview of /v1/me/data. The server returns the exact counts the
  // real DELETE would report, without touching storage. Surfaced in the UI so
  // a customer can see what they are about to erase before typing DELETE.
  meDeleteDataPreview: () =>
    j<{
      schema: 'clawmind.user-deletion-preview.v1';
      userId: string;
      dryRun: true;
      previewedAt: number;
      wouldRemove: {
        historyItems: number;
        conversations: number;
        savedItems: number;
        feedbackVotes: number;
        apiKeys: number;
      };
    }>('/v1/me/data?dry_run=true', { method: 'DELETE', body: JSON.stringify({ confirm: 'DELETE' }) }),

  webhookEvents: () => j<{ events: WebhookEvent[] }>('/v1/webhooks/events').then((r) => r.events),
  webhooksList: () => j<{ items: Webhook[] }>('/v1/webhooks').then((r) => r.items),
  webhookCreate: (input: { url: string; events: WebhookEvent[] }) =>
    j<{ webhook: Webhook }>('/v1/webhooks', { method: 'POST', body: JSON.stringify(input) }).then((r) => r.webhook),
  webhookUpdate: (id: string, patch: { url?: string; events?: WebhookEvent[]; active?: boolean }) =>
    j<{ webhook: Webhook }>(`/v1/webhooks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then((r) => r.webhook),
  webhookDelete: (id: string) => j<{ ok: boolean }>(`/v1/webhooks/${id}`, { method: 'DELETE' }),
  webhookTest: (id: string) =>
    j<{ delivery: WebhookDelivery }>(`/v1/webhooks/${id}/test`, { method: 'POST' }).then((r) => r.delivery),
  webhookRotateSecret: (id: string, graceMs?: number) =>
    j<{ webhook: Webhook; rotatedAt: number; previousSecretExpiresAt: number | null }>(
      `/v1/webhooks/${id}/rotate-secret`,
      { method: 'POST', body: JSON.stringify(graceMs !== undefined ? { graceMs } : {}) },
    ),
  webhookRedeliver: (deliveryId: string) =>
    j<{ delivery: WebhookDelivery }>(`/v1/webhooks/deliveries/${deliveryId}/redeliver`, { method: 'POST' }).then((r) => r.delivery),
  webhookDeliveries: (webhookId?: string, limit?: number) => {
    const qs = new URLSearchParams();
    if (webhookId) qs.set('webhookId', webhookId);
    if (limit) qs.set('limit', String(limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return j<{ items: WebhookDelivery[] }>(`/v1/webhooks/deliveries${suffix}`).then((r) => r.items);
  },

  // Conversations
  conversationsList: (archived = false) =>
    j<{ items: ConversationListItem[] }>(`/v1/conversations${archived ? '?archived=true' : ''}`).then((r) => r.items),
  conversationsSearch: (opts: { q?: string; archived?: boolean; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.q) params.set('q', opts.q);
    if (opts.archived) params.set('archived', 'true');
    if (opts.limit != null) params.set('limit', String(opts.limit));
    if (opts.offset != null) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return j<ConversationSearchResult>(`/v1/conversations${qs ? `?${qs}` : ''}`);
  },
  conversationCreate: (title?: string) =>
    j<{ conversation: Conversation }>('/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }).then((r) => r.conversation),
  conversationGet: (id: string) =>
    j<{ conversation: Conversation }>(`/v1/conversations/${id}`).then((r) => r.conversation),
  conversationRename: (id: string, title: string) =>
    j<{ conversation: { id: string; title: string; updatedAt: number } }>(`/v1/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }).then((r) => r.conversation),
  conversationArchive: (id: string) =>
    j<{ id: string; archivedAt: number }>(`/v1/conversations/${id}/archive`, { method: 'POST' }),
  conversationUnarchive: (id: string) =>
    j<{ id: string; archivedAt: null }>(`/v1/conversations/${id}/unarchive`, { method: 'POST' }),
  conversationDelete: (id: string) =>
    j<{ ok: boolean }>(`/v1/conversations/${id}`, { method: 'DELETE' }),
  conversationAsk: (id: string, q: string, k = 6) =>
    j<{ id: string; conversationId: string; rewrittenQuery?: string; text: string; sources: Source[]; model?: string }>(
      `/v1/conversations/${id}/ask`,
      { method: 'POST', body: JSON.stringify({ q, k }) },
    ),
  conversationAskStream: (
    id: string,
    body: { q: string; k?: number; namespaces?: string[] },
    onEvent: (e: { type: string; value: unknown }) => void,
  ) => streamPost(`${BASE}/v1/conversations/${id}/ask/stream`, body, onEvent),
  conversationExportUrl: (id: string) => `${BASE}/v1/conversations/${id}/export.md`,
  conversationExportJsonUrl: (id: string) => `${BASE}/v1/conversations/${id}/export.json`,
  conversationExportCsvUrl: (id: string) => `${BASE}/v1/conversations/${id}/export.csv`,

  // Tags: workspace-wide labels on source paths. Reads are open to any auth'd
  // user; writes require owner role and the UI surfaces the resulting 403
  // through the standard ApiError flow.
  tagsList: () =>
    j<{ items: TagSummary[]; count: number }>('/v1/tags').then((r) => r.items),
  tagDetail: (tag: string) =>
    j<{ tag: string; paths: string[]; count: number }>(`/v1/tags/${encodeURIComponent(tag)}`),
  tagsForPath: (path: string) =>
    j<{ path: string; tags: string[] }>(`/v1/tags/by-path?path=${encodeURIComponent(path)}`),
  tagsSetForPath: (path: string, tags: string[]) =>
    j<{ path: string; tags: string[] }>('/v1/tags/by-path', {
      method: 'PUT',
      body: JSON.stringify({ path, tags }),
    }),
  tagsAddForPath: (path: string, tags: string[]) =>
    j<{ path: string; tags: string[] }>('/v1/tags/by-path', {
      method: 'POST',
      body: JSON.stringify({ path, tags }),
    }),
  tagsRemoveForPath: (path: string, tags?: string[]) =>
    j<{ path: string; tags: string[] }>('/v1/tags/by-path', {
      method: 'DELETE',
      body: JSON.stringify({ path, ...(tags ? { tags } : {}) }),
    }),

  // Aliases: short names for long source paths. Used by the rag plugin at
  // both query-rewrite and citation-render time, so the UI doubles as a
  // canonical place to discover what shortcuts exist.
  aliasesList: () =>
    j<{ items: AliasEntry[]; count: number }>('/v1/aliases').then((r) => r.items),
  aliasAdd: (name: string, path: string) =>
    j<AliasEntry>('/v1/aliases', {
      method: 'POST',
      body: JSON.stringify({ name, path }),
    }),
  aliasRemove: (name: string) =>
    j<{ ok: boolean }>('/v1/aliases', {
      method: 'DELETE',
      body: JSON.stringify({ name }),
    }),

  // Mutes: inverse of pins. A muted source still exists in the index but is
  // demoted at retrieval time. Reason text is optional but encouraged so a
  // future operator can audit why a source was suppressed.
  mutesList: () =>
    j<{ items: MuteEntry[]; count: number }>('/v1/mutes').then((r) => r.items),
  muteAdd: (path: string, reason?: string) =>
    j<MuteEntry>('/v1/mutes', {
      method: 'POST',
      body: JSON.stringify({ path, ...(reason ? { reason } : {}) }),
    }),
  muteRemove: (path: string) =>
    j<{ ok: boolean }>('/v1/mutes', {
      method: 'DELETE',
      body: JSON.stringify({ path }),
    }),

  // Stale: diagnostic listing of sources whose last successful ingest is
  // older than `olderThanDays`. The API clamps the threshold server-side so
  // we pass the user input through verbatim.
  staleList: (opts: { olderThanDays?: number; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.olderThanDays != null) params.set('olderThanDays', String(opts.olderThanDays));
    if (opts.limit != null) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return j<StaleResult>(`/v1/sources/stale${qs ? `?${qs}` : ''}`);
  },

  // Doctor: cross-store consistency report. Read-only, safe to refresh.
  doctor: () => j<DoctorReport>('/v1/doctor'),

  // Maintenance: compact prunes manifest, BM25, and LanceDB entries whose
  // source files no longer exist. Always preview with dryRun before the
  // destructive call so users see what they are about to drop. Owner-only
  // server-side, so non-owners will get a 4xx surfaced as an error.
  maintenanceCompact: (dryRun: boolean) =>
    j<CompactReport>('/v1/maintenance/compact', {
      method: 'POST',
      body: JSON.stringify({ dryRun }),
    }),

  // Bulk forget: drop every indexed source whose absolute path matches
  // any picomatch glob in the list. Owner-only, MFA-stepped, rate-limited,
  // and audit-logged server-side. Always run with dryRun first so the UI
  // can show the exact files about to be removed.
  maintenanceForget: (patterns: string[], dryRun: boolean) =>
    j<ForgetReport>('/v1/maintenance/forget', {
      method: 'POST',
      body: JSON.stringify({ patterns, dryRun }),
    }),

  // Related: server returns sources semantically near the average embedding
  // of the given path's chunks. Useful as a "what else is like this" panel
  // from the source viewer. namespaces filter is optional.
  related: (path: string, opts: { k?: number; namespaces?: string[] } = {}) => {
    const params = new URLSearchParams({ path });
    if (opts.k != null) params.set('k', String(opts.k));
    if (opts.namespaces?.length) params.set('namespaces', opts.namespaces.join(','));
    return j<RelatedResult>(`/v1/related?${params.toString()}`);
  },

  // Snapshots: per-saved-search captures of the current top-N sources. The
  // diff endpoint runs the saved query again and compares fresh results to
  // the chosen baseline so drift becomes visible without leaving the UI.
  snapshotsList: (savedId: string) =>
    j<{ items: SnapshotSummary[] }>(`/v1/saved/${encodeURIComponent(savedId)}/snapshots`).then((r) => r.items),
  snapshotCapture: (savedId: string, body: { label?: string; k?: number } = {}) =>
    j<{ snapshot: SnapshotEntry }>(`/v1/saved/${encodeURIComponent(savedId)}/snapshots`, {
      method: 'POST',
      body: JSON.stringify(body),
    }).then((r) => r.snapshot),
  snapshotGet: (savedId: string, id: string) =>
    j<{ snapshot: SnapshotEntry }>(
      `/v1/saved/${encodeURIComponent(savedId)}/snapshots/${encodeURIComponent(id)}`,
    ).then((r) => r.snapshot),
  snapshotDelete: (savedId: string, id: string) =>
    j<{ ok: boolean }>(
      `/v1/saved/${encodeURIComponent(savedId)}/snapshots/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),
  snapshotDiff: (savedId: string, id: string) =>
    j<{ diff: SnapshotDiff; current: Source[] }>(
      `/v1/saved/${encodeURIComponent(savedId)}/snapshots/${encodeURIComponent(id)}/diff`,
      { method: 'POST' },
    ),

  // Notifications
  listNotifications: (params: { limit?: number; unread?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.unread) qs.set('unread', '1');
    const q = qs.toString();
    return j<{ items: NotificationItem[]; unread: number }>(
      `/v1/notifications${q ? `?${q}` : ''}`,
    );
  },
  notificationsUnreadCount: () =>
    j<{ unread: number }>('/v1/notifications/unread-count'),
  markNotificationsRead: (input: { ids?: string[]; all?: boolean }) => {
    const body = input.all ? { all: true } : { ids: input.ids ?? [] };
    return j<{ touched: number }>('/v1/notifications/read', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  deleteNotification: (id: string) =>
    j<{ id: string; deleted: boolean }>(
      `/v1/notifications/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),
  clearNotifications: () =>
    j<{ cleared: number }>('/v1/notifications', { method: 'DELETE' }),

  // Notification preferences
  getNotificationPreferences: () =>
    j<{ preferences: NotificationPreferences; knownKinds: NotificationKind[] }>(
      '/v1/notification-preferences',
    ),
  updateNotificationPreferences: (prefs: Partial<Record<NotificationKind, boolean>>) =>
    j<{ preferences: NotificationPreferences; knownKinds: NotificationKind[] }>(
      '/v1/notification-preferences',
      { method: 'PUT', body: JSON.stringify({ prefs }) },
    ),

  // Owner-only compliance audit log. The Fastify route enforces
  // role + scope, so a 401/403 here means "this user cannot review
  // the chain" and the UI should say so explicitly.
  auditQuery: (params: {
    actor?: string;
    action?: string;
    resource?: string;
    since?: number;
    until?: number;
    limit?: number;
    offset?: number;
  } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      q.set(k, String(v));
    }
    const qs = q.toString();
    return j<{ total: number; events: AuditEvent[] }>(
      `/v1/admin/audit${qs ? `?${qs}` : ''}`,
    );
  },
  auditVerify: () =>
    j<{ ok: boolean; checked: number; headHash: string | null; reason?: string; brokenAt?: { file: string; line: number; id?: string } }>(
      '/v1/admin/audit/verify',
    ),
  // Tamper-evident anchors over the audit chain. Anchors catch what the
  // plain chain cannot: truncation and rewrite of the on-disk log. The
  // record endpoint is owner + audit:anchor scope; list/verify are
  // audit:read so a delegated reviewer can still inspect them.
  auditAnchorList: (limit = 100) =>
    j<{
      total: number;
      anchors: Array<{
        id: string;
        ts: number;
        headHash: string;
        checked: number;
        note?: string;
        hmac: string;
        signatureValid: boolean;
      }>;
    }>(`/v1/admin/audit/anchors?limit=${limit}`),
  auditAnchorVerify: () =>
    j<{
      ok: boolean;
      signatureValid: boolean;
      chainMatches: boolean;
      reason:
        | 'no-anchors'
        | 'bad-signature'
        | 'chain-truncated'
        | 'chain-rewritten'
        | null;
      anchor: {
        id: string;
        ts: number;
        headHash: string;
        checked: number;
        note?: string;
        hmac: string;
      } | null;
    }>('/v1/admin/audit/anchors/verify'),
  auditAnchorRecord: (note?: string) =>
    j<{
      id: string;
      ts: number;
      headHash: string;
      checked: number;
      note?: string;
      hmac: string;
    }>('/v1/admin/audit/anchors', {
      method: 'POST',
      body: JSON.stringify(note ? { note } : {}),
    }),
  // Stream the full chain (subject to the same filters as auditQuery)
  // as a blob the browser can save. We pull through fetch instead of a
  // raw anchor so the request inherits the same cookie credentials used
  // by every other call in this client, including in cross-origin
  // deploys where the api lives at a different hostname.
  auditExport: async (params: {
    actor?: string;
    action?: string;
    resource?: string;
    since?: number;
    until?: number;
    format?: 'jsonl' | 'csv';
  } = {}): Promise<{ blob: Blob; filename: string }> => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      q.set(k, String(v));
    }
    const qs = q.toString();
    const res = await fetch(`${BASE}/v1/admin/audit/export${qs ? `?${qs}` : ''}`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) {
      let body: unknown;
      try { body = await res.json(); } catch { body = await res.text().catch(() => null); }
      throw new ApiError(res.status, '/v1/admin/audit/export', body);
    }
    const disp = res.headers.get('content-disposition') || '';
    const match = /filename="?([^";]+)"?/.exec(disp);
    const fallback = `audit-${new Date().toISOString().replace(/[:.]/g, '-')}.${params.format ?? 'jsonl'}`;
    return { blob: await res.blob(), filename: match?.[1] || fallback };
  },

  // Unified admin console aggregator. Owner-only and admin:read scoped.
  // One round trip backs the entire /admin page so reviewers can answer
  // "is this tenant configured safely" without clicking eight settings
  // panels.
  adminOverview: () => j<AdminOverview>('/v1/admin/overview'),

  // Domain auto-join policies. Admin+ can read; owner/admin can replace
  // with MFA step-up. The auth preHandler consults this list on every
  // login and uses the matching role as the default for brand-new users.
  domainPoliciesList: () =>
    j<{ policies: DomainPolicy[]; assignableRoles: AutoJoinRole[]; maxPolicies: number }>(
      '/v1/domain-policies',
    ),
  domainPoliciesReplace: (policies: Array<{ domain: string; role: AutoJoinRole; enabled: boolean; requireSso?: boolean }>) =>
    j<{ policies: DomainPolicy[] }>('/v1/domain-policies', {
      method: 'PUT',
      body: JSON.stringify({ policies }),
    }).then((r) => r.policies),

  // SCIM workspace bearer token. Plaintext is returned exactly once on
  // rotate; the GET only surfaces metadata (presence, createdAt, lastUsedAt).
  scimTokenGet: () =>
    j<{ token: ScimTokenView }>('/v1/scim/token').then((r) => r.token),
  scimTokenRotate: () =>
    j<{ id: string; token: string; createdAt: number }>('/v1/scim/token', { method: 'POST' }),
  scimTokenRevoke: () =>
    j<{ revoked: boolean }>('/v1/scim/token', { method: 'DELETE' }),

  // Workspace policy acceptance (TOS / DPA / AUP). Read is granted to
  // every authenticated caller so the UI can render the accept screen;
  // publish is owner-only with MFA step-up; accept is per-user.
  policiesCurrent: () =>
    j<{ items: Policy[] }>('/v1/policies').then((r) => r.items),
  policiesAll: (opts?: { kind?: PolicyKind; includeSuperseded?: boolean }) => {
    const qs = new URLSearchParams();
    if (opts?.kind) qs.set('kind', opts.kind);
    if (opts?.includeSuperseded) qs.set('include_superseded', 'true');
    const q = qs.toString();
    return j<{ items: Policy[] }>(`/v1/policies/all${q ? `?${q}` : ''}`).then(
      (r) => r.items,
    );
  },
  policiesMe: () =>
    j<{ acceptances: PolicyAcceptance[]; unmet: Policy[]; current: Policy[] }>(
      '/v1/policies/me',
    ),
  policiesPublish: (input: {
    kind: PolicyKind;
    title: string;
    body: string;
    required?: boolean;
    effectiveAt?: number | null;
  }) =>
    j<{ policy: Policy }>('/v1/policies', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((r) => r.policy),
  policiesAccept: (policyId: string) =>
    j<{ acceptance: PolicyAcceptance }>(
      `/v1/policies/${encodeURIComponent(policyId)}/accept`,
      { method: 'POST' },
    ).then((r) => r.acceptance),
  policiesAcceptances: (opts?: { userId?: string; policyId?: string }) => {
    const qs = new URLSearchParams();
    if (opts?.userId) qs.set('user_id', opts.userId);
    if (opts?.policyId) qs.set('policy_id', opts.policyId);
    const q = qs.toString();
    return j<{ items: PolicyAcceptance[] }>(
      `/v1/policies/acceptances${q ? `?${q}` : ''}`,
    ).then((r) => r.items);
  },
  policiesSummary: () =>
    j<{ items: PolicyAcceptanceSummary[] }>('/v1/policies/summary').then(
      (r) => r.items,
    ),

  // Workspace query blocklist. Owner-managed list of literal/regex
  // patterns enforced before retrieval and the LLM on /v1/ask,
  // /v1/ask/stream, /v1/search, /v1/explain. A matched query is
  // rejected with 422 'query-blocked'.
  queryBlocklistList: () =>
    j<{ rules: BlocklistRule[] }>('/v1/query-blocklist').then((r) => r.rules),
  queryBlocklistAdd: (input: {
    pattern: string;
    mode?: 'literal' | 'regex';
    label?: string | null;
  }) =>
    j<{ rule: BlocklistRule }>('/v1/query-blocklist', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((r) => r.rule),
  queryBlocklistRemove: (id: string) =>
    j<{ rule: BlocklistRule }>(`/v1/query-blocklist/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }).then((r) => r.rule),

  // Workspace LLM model allowlist. Owner-managed policy controlling
  // which model identifiers may serve answers. Enforced on /v1/ask and
  // /v1/ask/stream; a non-approved model returns 422 'model-not-allowed'.
  modelAllowlistGet: () =>
    j<{ policy: ModelAllowlistPolicy }>('/v1/model-allowlist').then((r) => r.policy),
  modelAllowlistSetMode: (mode: ModelAllowlistMode) =>
    j<{ policy: ModelAllowlistPolicy }>('/v1/model-allowlist/mode', {
      method: 'PUT',
      body: JSON.stringify({ mode }),
    }).then((r) => r.policy),
  modelAllowlistAdd: (input: { model: string; label?: string | null }) =>
    j<{ rule: ModelAllowlistRule }>('/v1/model-allowlist', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((r) => r.rule),
  modelAllowlistRemove: (id: string) =>
    j<{ rule: ModelAllowlistRule }>(`/v1/model-allowlist/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }).then((r) => r.rule),

  // Workspace PII redaction policy. Owner-managed detector classes
  // (email/phone/ssn/credit_card/ipv4 plus custom regex) enforced
  // before retrieval and the LLM on /v1/ask, /v1/ask/stream,
  // /v1/search, /v1/explain and /v1/ask/batch. 'redact' rewrites
  // matches in place; 'block' rejects the request with 422
  // 'pii-blocked'.
  piiRedactionGet: () =>
    j<{ policy: PiiRedactionPolicy }>('/v1/pii-redaction').then((r) => r.policy),
  piiRedactionPut: (input: {
    builtins?: Partial<Record<PiiBuiltinClass, PiiAction>>;
    custom?: Array<{ id?: string; label: string; pattern: string; action: PiiAction }>;
  }) =>
    j<{ policy: PiiRedactionPolicy }>('/v1/pii-redaction', {
      method: 'PUT',
      body: JSON.stringify(input),
    }).then((r) => r.policy),

  // API-key brute-force throttle. Surfaces the currently locked source
  // IPs, recent failed attempts, and the policy parameters so an admin
  // can demo "failed-key probing is blocked at the front door".
  apiKeyBruteForceGet: () =>
    j<{
      config: { maxFails: number; windowMs: number; lockoutMs: number };
      ips: Array<{
        ip: string;
        locked: boolean;
        recent: number;
        lockedUntil: number;
        totalFails: number;
        totalLocks: number;
        lastReason: string | null;
      }>;
      recent: Array<{
        ts: number;
        event: 'fail' | 'lock' | 'unlock';
        ip: string;
        reason: string;
        recent: number;
        lockedUntil: number;
      }>;
      summary: { tracked: number; locked: number };
    }>('/v1/api-key-bruteforce'),
  apiKeyBruteForceUnlock: (ip: string) =>
    j<{ ok: boolean; ip: string }>(
      `/v1/api-key-bruteforce/${encodeURIComponent(ip)}`,
      { method: 'DELETE' },
    ),

  // Sub-processor registry. GET /sub-processors is public (no auth) so
  // customer DPAs can cite the URL; the admin view surfaces internal
  // notes and updatedBy for the operator console.
  subProcessorsPublic: () =>
    j<{
      intro: string;
      contactEmail: string | null;
      updatedAt: number;
      entries: SubProcessor[];
    }>('/v1/sub-processors'),
  subProcessorsAdmin: () =>
    j<SubProcessorRegistry>('/v1/sub-processors/admin'),
  subProcessorsCreate: (body: {
    name: string;
    purpose: string;
    region: string;
    website?: string | null;
    notes?: string | null;
  }) =>
    j<{ entry: SubProcessor; registry: SubProcessorRegistry }>(
      '/v1/sub-processors',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  subProcessorsUpdate: (
    id: string,
    body: Partial<{
      name: string;
      purpose: string;
      region: string;
      website: string | null;
      notes: string | null;
      status: 'active' | 'retired';
    }>,
  ) =>
    j<{ entry: SubProcessor; registry: SubProcessorRegistry }>(
      `/v1/sub-processors/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
  subProcessorsRetire: (id: string) =>
    j<{ entry: SubProcessor; registry: SubProcessorRegistry }>(
      `/v1/sub-processors/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),
  subProcessorsSettings: (body: { intro?: string; contactEmail?: string | null }) =>
    j<SubProcessorRegistry>('/v1/sub-processors/settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  // Data Subject Request queue. POST /v1/dsr/submit is intentionally
  // public (no auth) so non-members can exercise GDPR/CCPA rights; the
  // verifyToken is returned exactly once and must be sent back through
  // GET /v1/dsr/verify/:id/:token to move the row out of 'unverified'.
  dsrSubmit: (body: {
    subjectEmail: string;
    kind: DsrKind;
    details?: string | null;
    workspaceId?: string | null;
    // Honeypot field. Real users leave this blank; bots fill every input
    // and trip the server-side trap. Optional on the wire.
    website?: string;
  }) =>
    j<{ id: string; status: DsrStatus; verifyToken: string; verifyPath: string }>(
      '/v1/dsr/submit',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  dsrVerify: (id: string, token: string) =>
    j<{ request: { id: string; kind: DsrKind; status: DsrStatus; createdAt: number; verifiedAt: number | null; resolvedAt: number | null } }>(
      `/v1/dsr/verify/${encodeURIComponent(id)}/${encodeURIComponent(token)}`,
    ),
  dsrList: (status?: DsrStatus) =>
    j<{ requests: DsrRecord[] }>(
      `/v1/dsr${status ? `?status=${encodeURIComponent(status)}` : ''}`,
    ).then((r) => r.requests),
  dsrGet: (id: string) =>
    j<{ request: DsrRecord }>(`/v1/dsr/${encodeURIComponent(id)}`).then((r) => r.request),
  dsrUpdate: (id: string, body: { status?: DsrStatus; note?: string | null }) =>
    j<{ request: DsrRecord }>(`/v1/dsr/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }).then((r) => r.request),

  // Trust Center. Public GET /v1/trust is the URL procurement / vendor
  // review tools crawl, so it must stay unauthenticated. PUT is owner+MFA.
  trustPublic: () => j<TrustPublicProfile>('/v1/trust'),
  trustAdmin: () => j<TrustProfile>('/v1/trust/admin'),
  trustUpdate: (body: Partial<TrustProfileInput>) =>
    j<TrustProfile>('/v1/trust', { method: 'PUT', body: JSON.stringify(body) }),

  // Break-glass / time-bound role elevation. Members file a request with
  // a reason and bounded duration; an owner approves with MFA step-up;
  // the API auth plugin overlays the elevated role for the window and
  // drops back automatically when expiresAt passes.
  roleElevationList: () =>
    j<{ records: RoleElevationRequest[] }>('/v1/role-elevation/requests').then((r) => r.records),
  roleElevationCreate: (input: RoleElevationCreateInput) =>
    j<{ request: RoleElevationRequest }>('/v1/role-elevation/requests', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((r) => r.request),
  roleElevationApprove: (id: string) =>
    j<{ request: RoleElevationRequest }>(`/v1/role-elevation/requests/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
    }).then((r) => r.request),
  roleElevationDeny: (id: string, reason?: string) =>
    j<{ request: RoleElevationRequest }>(`/v1/role-elevation/requests/${encodeURIComponent(id)}/deny`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason ?? '' }),
    }).then((r) => r.request),
  roleElevationRevoke: (id: string) =>
    j<{ request: RoleElevationRequest }>(`/v1/role-elevation/requests/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
    }).then((r) => r.request),

  // Security Incident Disclosure Log. Public GET /v1/incidents is the URL
  // procurement / vendor review tools crawl, so it must stay unauthenticated.
  // Writes are owner+MFA at the API.
  incidentsPublic: () => j<IncidentsPublicList>('/v1/incidents'),
  incidentsAdmin: () =>
    j<{ incidents: Incident[] }>('/v1/incidents/admin').then((r) => r.incidents),
  incidentsCreate: (body: IncidentInput) =>
    j<Incident>('/v1/incidents', { method: 'POST', body: JSON.stringify(body) }),
  incidentsUpdate: (id: string, body: IncidentInput) =>
    j<Incident>(`/v1/incidents/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  incidentsDelete: (id: string) =>
    j<{ deleted: boolean }>(`/v1/incidents/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';
export interface IncidentUpdate {
  at: number;
  message: string;
  status: IncidentStatus;
}
export interface Incident {
  id: string;
  title: string;
  summary: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  startedAt: number;
  resolvedAt: number | null;
  affectedComponents: string[];
  customerDataImpacted: boolean;
  updates: IncidentUpdate[];
  privateNotes: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string | null;
}
export interface IncidentPublic {
  id: string;
  title: string;
  summary: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  startedAt: number;
  resolvedAt: number | null;
  affectedComponents: string[];
  customerDataImpacted: boolean;
  updates: IncidentUpdate[];
}
export interface IncidentsPublicList {
  incidents: IncidentPublic[];
  generatedAt: number;
}
export interface IncidentInput {
  title: string;
  summary?: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  startedAt: number;
  resolvedAt?: number | null;
  affectedComponents?: string[];
  customerDataImpacted?: boolean;
  updates?: Array<{ at?: number; message: string; status: IncidentStatus }>;
  privateNotes?: string;
}

export type RoleElevationStatus = 'pending' | 'approved' | 'revoked' | 'expired' | 'denied';

export interface RoleElevationRequest {
  id: string;
  userId: string;
  fromRole: 'owner' | 'admin' | 'member' | 'viewer';
  toRole: 'owner' | 'admin' | 'member' | 'viewer';
  reason: string;
  requestedAt: number;
  durationMinutes: number;
  status: RoleElevationStatus;
  approvedBy: string | null;
  approvedAt: number | null;
  expiresAt: number | null;
  revokedBy: string | null;
  revokedAt: number | null;
  decisionReason: string | null;
}

export interface RoleElevationCreateInput {
  toRole: 'admin' | 'owner';
  reason: string;
  durationMinutes: number;
}

export type ComplianceStatus = 'in_progress' | 'achieved' | 'not_pursued';
export interface ComplianceFramework {
  name: string;
  status: ComplianceStatus;
  issuedAt: string | null;
  auditor: string | null;
  reportUrl: string | null;
}
export interface TrustLink { label: string; url: string }
export interface TrustProfile {
  summary: string;
  securityContactEmail: string | null;
  vulnerabilityPolicyUrl: string | null;
  frameworks: ComplianceFramework[];
  encryptionAtRest: string | null;
  encryptionInTransit: string | null;
  dataResidency: string | null;
  links: TrustLink[];
  updatedAt: number;
  updatedBy: string | null;
}
export interface TrustPublicProfile extends Omit<TrustProfile, 'updatedBy'> {
  generatedAt: number;
}
export interface TrustProfileInput {
  summary: string;
  securityContactEmail: string | null;
  vulnerabilityPolicyUrl: string | null;
  frameworks: ComplianceFramework[];
  encryptionAtRest: string | null;
  encryptionInTransit: string | null;
  dataResidency: string | null;
  links: TrustLink[];
}

export type DsrKind = 'access' | 'erasure' | 'rectification' | 'portability' | 'restriction';
export type DsrStatus = 'unverified' | 'pending' | 'acknowledged' | 'fulfilled' | 'rejected';
export interface DsrRecord {
  id: string;
  workspaceId: string;
  subjectEmail: string;
  kind: DsrKind;
  details: string;
  status: DsrStatus;
  verifiedAt: number | null;
  note: string | null;
  resolvedBy: string | null;
  resolvedAt: number | null;
  createdAt: number;
  updatedAt: number;
  submitterIpHash: string | null;
}

export interface SubProcessor {
  id: string;
  name: string;
  purpose: string;
  region: string;
  website: string | null;
  status: 'active' | 'retired';
  disclosedAt: number;
  updatedAt: number;
  notes: string | null;
}

export interface SubProcessorRegistry {
  intro: string;
  contactEmail: string | null;
  entries: SubProcessor[];
  updatedAt: number;
  updatedBy: string | null;
}

export type PiiAction = 'off' | 'redact' | 'block';
export type PiiBuiltinClass = 'email' | 'phone' | 'ssn' | 'credit_card' | 'ipv4';
export interface PiiCustomRule {
  id: string;
  label: string;
  pattern: string;
  action: PiiAction;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}
export interface PiiRedactionPolicy {
  version: 1;
  builtins: Record<PiiBuiltinClass, PiiAction>;
  custom: PiiCustomRule[];
  updatedAt: number;
  updatedBy: string | null;
}

export interface BlocklistRule {
  id: string;
  pattern: string;
  mode: 'literal' | 'regex';
  label: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export type ModelAllowlistMode = 'disabled' | 'allow' | 'block';

export interface ModelAllowlistRule {
  id: string;
  model: string;
  label: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface ModelAllowlistPolicy {
  version: 1;
  mode: ModelAllowlistMode;
  models: ModelAllowlistRule[];
  updatedBy: string | null;
  updatedAt: number;
}

export type PolicyKind = 'tos' | 'dpa' | 'aup';

export interface Policy {
  id: string;
  kind: PolicyKind;
  title: string;
  body: string;
  bodyHash: string;
  required: boolean;
  publishedBy: string;
  publishedAt: number;
  effectiveAt: number;
  supersededAt: number | null;
}

export interface PolicyAcceptance {
  policyId: string;
  userId: string;
  acceptedAt: number;
  ip: string;
  userAgent: string;
}

export interface PolicyAcceptanceSummary {
  policy: Policy;
  acceptedUserIds: string[];
  acceptedCount: number;
}

export interface ScimTokenView {
  present: boolean;
  id: string | null;
  createdAt: number | null;
  createdBy: string | null;
  lastUsedAt: number | null;
}

export type AutoJoinRole = 'member' | 'viewer';
export interface DomainPolicy {
  domain: string;
  role: AutoJoinRole;
  enabled: boolean;
  requireSso: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AdminOverview {
  user: { id: string; role: string };
  mfa: { enrolled: boolean; confirmed: boolean; recoveryCodes: number };
  sso: { configured: boolean; issuer: string | null; clientId: string | null; allowedDomains: string[] };
  sessions: { active: number; lastSeenAt: number | null };
  apiKeys: { total: number; active: number; revoked: number; lastUsedAt: number | null };
  webhooks: { configured: number; deliveriesRecent: number; failuresRecent: number; lastDeliveryAt: number | null };
  ipAllowlist: { enabled: boolean; rules: number };
  retention: { historyDays: number | null; conversationDays: number | null; auditDays: number | null; lastSweepAt: number | null };
  audit: { headHash: string | null; verified: boolean; recentEvents: number };
}

export interface AuditEvent {
  id: string;
  ts: number;
  actor: string;
  action: string;
  resource: string;
  meta?: Record<string, unknown>;
  prevHash?: string;
  hash?: string;
}

export type NotificationKind =
  | 'share.viewed'
  | 'webhook.disabled'
  | 'webhook.failed'
  | 'system';

export interface NotificationPreferences {
  userId: string;
  prefs: Partial<Record<NotificationKind, boolean>>;
  updatedAt: number;
}

export interface NotificationItem {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string;
  createdAt: number;
  readAt: number | null;
  meta?: Record<string, string | number | boolean | null>;
}

export interface RelatedItem {
  path: string;
  namespace: string;
  score: number;
  hits: number;
  bestChunkId: string;
  excerpt: string;
}

export interface RelatedResult {
  path: string;
  sourceChunkCount: number;
  items: RelatedItem[];
  count: number;
}

export interface SnapshotSummary {
  id: string;
  label: string | null;
  ts: number;
  sourceCount: number;
}

export interface SnapshotEntry extends SnapshotSummary {
  savedSearchId: string;
  userId: string;
  sources: Source[];
}

export interface SnapshotDiff {
  baselineId: string;
  baselineTs: number;
  currentTs: number;
  added: Source[];
  removed: Source[];
  unchanged: string[];
}

export type DoctorSeverity = 'info' | 'warn' | 'error';

export interface DoctorFinding {
  severity: DoctorSeverity;
  code: string;
  message: string;
  hint?: string;
}

export interface DoctorReport {
  ok: boolean;
  generatedAt: number;
  counts: {
    manifestDocs: number;
    manifestChunks: number;
    bm25Chunks: number;
    lanceChunks: number;
  };
  findings: DoctorFinding[];
}

export interface CompactReport {
  dryRun: boolean;
  scanned: number;
  kept: number;
  removed: number;
  removedPaths?: string[];
}

export interface ForgetReport {
  dryRun: boolean;
  matched: number;
  removedChunks: number;
  removedPaths: string[];
}

export interface TagSummary {
  tag: string;
  count: number;
}

export interface AliasEntry {
  name: string;
  path: string;
  createdBy: string;
  createdAt: number;
}

export interface MuteEntry {
  path: string;
  reason?: string;
  mutedBy: string;
  mutedAt: number;
}

export interface StaleEntry {
  path: string;
  ingestedAt: number;
  ageMs: number;
  ageDays: number;
  chunkCount: number;
  size: number;
}

export interface StaleResult {
  thresholdDays: number;
  thresholdMs: number;
  asOf: number;
  total: number;
  items: StaleEntry[];
}

async function streamPost(
  url: string,
  body: unknown,
  onEvent: (e: { type: string; value: unknown }) => void,
) {
  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
  });
  if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const p of parts) {
      const line = p.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try { onEvent(JSON.parse(line.slice(5).trim())); } catch { /* skip */ }
    }
  }
}

export function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtRelative(ts: number | null): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
