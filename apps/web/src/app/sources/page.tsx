'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { TopNav } from '@/components/TopNav';
import {
  api,
  fmtBytes,
  fmtRelative,
  type FeedbackEntry,
  type SourceListItem,
} from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconSearch,
  IconFolder,
  IconThumbsUp,
  IconThumbsDown,
  IconRefresh,
} from '@clawmind/ui';

const sortLabels: Record<'recent' | 'path' | 'chunks', string> = {
  recent: 'Recently indexed',
  path: 'Path A to Z',
  chunks: 'Most chunks',
};

export default function SourcesPage() {
  const [q, setQ] = useState('');
  const [namespace, setNamespace] = useState<string>('');
  const [sort, setSort] = useState<'recent' | 'path' | 'chunks'>('recent');
  const [items, setItems] = useState<SourceListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<SourceListItem | null>(null);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, FeedbackEntry>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, fb] = await Promise.all([
        api.sourcesList({ q: q.trim() || undefined, namespace: namespace || undefined, sort, limit: 100 }),
        api.feedbackList().catch(() => []),
      ]);
      setItems(list.items);
      setTotal(list.total);
      setFeedbackMap(Object.fromEntries(fb.map((e) => [e.path, e])));
      if (!list.items.find((i) => active && i.path === active.path)) {
        setActive(list.items[0] ?? null);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, namespace, sort]);

  useEffect(() => { load(); }, [load]);

  const namespaces = useMemo(
    () => Array.from(new Set(items.map((i) => i.namespace))).sort(),
    [items],
  );

  async function vote(path: string, v: 1 | -1) {
    const current = feedbackMap[path];
    try {
      if (current && ((v === 1 && current.ups > current.downs) || (v === -1 && current.downs > current.ups))) {
        await api.feedbackClear(path);
        setFeedbackMap((m) => {
          const next = { ...m };
          delete next[path];
          return next;
        });
      } else {
        const res = await api.feedbackVote(path, v);
        setFeedbackMap((m) => ({ ...m, [path]: { ...res, updatedAt: Date.now() } }));
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sources</h1>
            <p className="mt-1 text-sm text-cm-muted">
              Every file in the index. Click a row to preview content and adjust ranking with a vote.
            </p>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 self-start rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
          >
            <IconRefresh size={14} /> Refresh
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cm-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by path"
              className="w-full rounded-md border border-cm-border bg-cm-subtle py-2 pl-9 pr-3 text-sm placeholder:text-cm-muted focus:outline-none focus:ring-2 focus:ring-cm-accent"
            />
          </div>
          <select
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            className="rounded-md border border-cm-border bg-cm-subtle px-3 py-2 text-sm"
          >
            <option value="">All namespaces</option>
            {namespaces.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="rounded-md border border-cm-border bg-cm-subtle px-3 py-2 text-sm"
          >
            {Object.entries(sortLabels).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        {loading && items.length === 0 ? (
          <div className="mt-12 flex justify-center"><Spinner /></div>
        ) : error ? (
          <div className="mt-8"><ErrorState message={error} onRetry={load} /></div>
        ) : items.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              title="No sources match"
              body="Try a different filter or run an ingest to index your workspace."
            />
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.2fr]">
            <div className="cm-card overflow-hidden">
              <div className="flex items-center justify-between border-b border-cm-border px-3 py-2 text-xs text-cm-muted">
                <span>{items.length} of {total}</span>
                <span>{namespaces.length} namespaces</span>
              </div>
              <ul className="max-h-[70vh] divide-y divide-cm-border overflow-auto">
                {items.map((it) => {
                  const fb = feedbackMap[it.path];
                  const isActive = active?.path === it.path;
                  return (
                    <li key={it.path}>
                      <button
                        onClick={() => setActive(it)}
                        className={[
                          'block w-full px-3 py-2.5 text-left text-sm transition-colors',
                          isActive ? 'bg-cm-accent-soft' : 'hover:bg-cm-bg',
                        ].join(' ')}
                      >
                        <div className="flex items-center gap-2">
                          <IconFolder size={14} className="shrink-0 text-cm-muted" />
                          <span className="truncate font-mono text-[13px]">{it.path}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-cm-muted">
                          <span className="rounded bg-cm-bg px-1.5 py-0.5">{it.namespace}</span>
                          <span>{it.chunks} chunks</span>
                          <span>{fmtBytes(it.bytes)}</span>
                          <span>{fmtRelative(it.ingestedAt)}</span>
                          {fb && fb.boost !== 0 && (
                            <span className={fb.boost > 0 ? 'text-cm-success' : 'text-cm-danger'}>
                              boost {fb.boost > 0 ? '+' : ''}{fb.boost.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <SourceDetail
              source={active}
              feedback={active ? feedbackMap[active.path] : undefined}
              onVote={vote}
            />
          </div>
        )}
      </div>
    </main>
  );
}

function SourceDetail({
  source,
  feedback,
  onVote,
}: {
  source: SourceListItem | null;
  feedback?: FeedbackEntry;
  onVote: (path: string, v: 1 | -1) => void;
}) {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!source) { setContent(''); return; }
    let cancel = false;
    setLoading(true);
    setError(null);
    api.sourceFile(source.path, 1, 200)
      .then((r) => { if (!cancel) setContent(r.content); })
      .catch((err) => { if (!cancel) setError((err as Error).message); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [source]);

  if (!source) {
    return (
      <div className="cm-card flex items-center justify-center p-12">
        <EmptyState title="Pick a source" body="Select a file from the list to preview it." />
      </div>
    );
  }

  const upActive = feedback && feedback.ups > feedback.downs;
  const downActive = feedback && feedback.downs > feedback.ups;

  return (
    <div className="cm-card flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-cm-border p-4">
        <div className="min-w-0">
          <div className="truncate font-mono text-sm">{source.path}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-cm-muted">
            <span className="rounded bg-cm-bg px-1.5 py-0.5">{source.namespace}</span>
            <span>{source.chunks} chunks</span>
            <span>{fmtBytes(source.bytes)}</span>
            <span>indexed {fmtRelative(source.ingestedAt)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => onVote(source.path, 1)}
            title="Boost this source"
            className={[
              'inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-sm transition-colors',
              upActive
                ? 'border-cm-success/40 bg-cm-success/10 text-cm-success'
                : 'border-cm-border text-cm-muted hover:text-cm-fg',
            ].join(' ')}
          >
            <IconThumbsUp size={14} /> {feedback?.ups ?? 0}
          </button>
          <button
            onClick={() => onVote(source.path, -1)}
            title="Penalize this source"
            className={[
              'inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-sm transition-colors',
              downActive
                ? 'border-cm-danger/40 bg-cm-danger/10 text-cm-danger'
                : 'border-cm-border text-cm-muted hover:text-cm-fg',
            ].join(' ')}
          >
            <IconThumbsDown size={14} /> {feedback?.downs ?? 0}
          </button>
        </div>
      </div>
      <div className="min-h-[300px] max-h-[60vh] overflow-auto p-4">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : error ? (
          <ErrorState message={error} />
        ) : content.trim() === '' ? (
          <EmptyState title="Empty file" body="This file has no readable content to preview." />
        ) : (
          <pre className="font-mono text-[12.5px] leading-relaxed text-cm-fg whitespace-pre-wrap">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}
