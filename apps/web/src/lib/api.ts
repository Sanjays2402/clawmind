// Single shared API client for the web app. Every call hits the Fastify
// service running locally and returns plain JSON. Errors carry the upstream
// status code in the message so UIs can branch on it.

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:7410';

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

export interface SavedSearch { id: string; title: string; query: string }

export const api = {
  health: () =>
    j<{ ok: boolean; embed: boolean; llm: boolean; docs: number; chunks: number }>('/health'),

  // Search and ask
  search: (body: { q: string; k?: number; namespaces?: string[]; highlight?: boolean; snippetWidth?: number }) =>
    j<{ hits: Source[] }>('/v1/search', { method: 'POST', body: JSON.stringify(body) }),
  ask: (body: { q: string; k?: number; namespaces?: string[] }) =>
    j<{ id: string; text: string; sources: Source[] }>('/v1/ask', { method: 'POST', body: JSON.stringify(body) }),
  stream: (
    body: { q: string; k?: number; namespaces?: string[] },
    onEvent: (e: { type: string; value: unknown }) => void,
  ) => streamPost(`${BASE}/v1/ask/stream`, body, onEvent),

  // History and saved
  history: () =>
    j<{ items: { id: string; ts: number; query: string; answer: string; model: string }[] }>(
      '/v1/history',
    ).then((r) => r.items),
  savedList: () => j<{ items: SavedSearch[] }>('/v1/saved').then((r) => r.items),
  saveSearch: (input: { title: string; query: string }) =>
    j<{ item: SavedSearch }>('/v1/saved', { method: 'POST', body: JSON.stringify(input) }).then((r) => r.item),
  removeSaved: (id: string) => j<void>(`/v1/saved/${id}`, { method: 'DELETE' }),
  share: (id: string) => j<{ id: string; query: string; answer: string }>(`/v1/share/${id}`),

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
};

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
