const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:7410';

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) }, credentials: 'include' });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => j<{ ok: boolean; embed: boolean; llm: boolean; docs: number; chunks: number }>('/health'),
  ask: (q: { q: string; k?: number; namespaces?: string[] }) => j<{ id: string; text: string; sources: unknown[] }>('/v1/ask', { method: 'POST', body: JSON.stringify(q) }),
  history: () => j<{ items: { id: string; ts: number; query: string; answer: string; model: string }[] }>('/v1/history').then((r) => r.items),
  savedList: () => j<{ items: { id: string; title: string; query: string }[] }>('/v1/saved').then((r) => r.items),
  share: (id: string) => j<{ id: string; query: string; answer: string }>(`/v1/share/${id}`),
  stream: (body: { q: string; k?: number; namespaces?: string[] }, onEvent: (e: { type: string; value: unknown }) => void) =>
    streamPost(`${BASE}/v1/ask/stream`, body, onEvent),
};

async function streamPost(url: string, body: unknown, onEvent: (e: { type: string; value: unknown }) => void) {
  const res = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, credentials: 'include' });
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
