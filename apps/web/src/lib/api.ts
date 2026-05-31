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

export interface ActiveSession {
  id: string;
  userAgent: string;
  ip: string;
  createdAt: number;
  lastSeenAt: number;
  revokedAt?: number;
  current: boolean;
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

export type WebhookEvent = 'ask.completed' | 'ingest.completed';

export interface Webhook {
  id: string;
  userId: string;
  url: string;
  events: WebhookEvent[];
  secret?: string; // only present in the create response
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
  createShare: (input: { query: string; answer: string; sources: Source[] }) =>
    j<{ id: string; url: string }>('/v1/share', { method: 'POST', body: JSON.stringify(input) }),
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
  meDeleteData: () =>
    j<{ userId: string; deletedAt: number; removed: Record<string, number> }>(
      '/v1/me/data',
      { method: 'DELETE', body: JSON.stringify({ confirm: 'DELETE' }) },
    ),

  webhookEvents: () => j<{ events: WebhookEvent[] }>('/v1/webhooks/events').then((r) => r.events),
  webhooksList: () => j<{ items: Webhook[] }>('/v1/webhooks').then((r) => r.items),
  webhookCreate: (input: { url: string; events: WebhookEvent[] }) =>
    j<{ webhook: Webhook }>('/v1/webhooks', { method: 'POST', body: JSON.stringify(input) }).then((r) => r.webhook),
  webhookUpdate: (id: string, patch: { url?: string; events?: WebhookEvent[]; active?: boolean }) =>
    j<{ webhook: Webhook }>(`/v1/webhooks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then((r) => r.webhook),
  webhookDelete: (id: string) => j<{ ok: boolean }>(`/v1/webhooks/${id}`, { method: 'DELETE' }),
  webhookTest: (id: string) =>
    j<{ delivery: WebhookDelivery }>(`/v1/webhooks/${id}/test`, { method: 'POST' }).then((r) => r.delivery),
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
};

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
