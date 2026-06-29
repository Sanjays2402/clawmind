'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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
  IconArrowRight,
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

  // Strongest |boost| in the current feedback set. The diverging boost bars
  // scale against it so the longest bar is always the most-nudged source and
  // every other reads proportionally — a relative shape, not an absolute one.
  const maxBoost = useMemo(() => {
    let m = 0;
    for (const fb of Object.values(feedbackMap)) {
      const a = Math.abs(fb.boost);
      if (a > m) m = a;
    }
    return m;
  }, [feedbackMap]);

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
                    <li key={it.path} className="relative">
                      <button
                        onClick={() => setActive(it)}
                        aria-current={isActive ? 'true' : undefined}
                        className={[
                          'block w-full px-3 py-2.5 pr-10 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-cm-accent focus-visible:ring-inset',
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
                            <BoostBar boost={fb.boost} max={maxBoost} />
                          )}
                        </div>
                      </button>
                      <Link
                        href={`/sources/view?path=${encodeURIComponent(it.path)}`}
                        className="cm-open-viewer"
                        aria-label={`Open ${it.path} in the source viewer`}
                        title="Open in viewer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M14 4h6v6" />
                          <path d="M20 4 11 13" />
                          <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
                        </svg>
                      </Link>
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

/**
 * Diverging boost signal. The per-source feedback boost used to render as raw
 * text ("boost +0.40"); a daily user had to read each number to feel which
 * sources are favoured vs penalised. This turns it into a shape around a centre
 * line: a positive boost grows RIGHT in success green, a negative boost grows
 * LEFT in danger red, each scaled to the strongest |boost| in view. The numeric
 * value still rides alongside for the exact figure.
 */
function BoostBar({ boost, max }: { boost: number; max: number }) {
  const up = boost > 0;
  // Proportion of the half-track this boost fills (min 8% so a tiny nudge is
  // still visible as a sliver). max can be 0 only when boost is 0, which the
  // caller already filters out.
  const frac = max > 0 ? Math.max(0.08, Math.min(1, Math.abs(boost) / max)) : 0;
  const pct = `${frac * 50}%`;
  const ink = up ? 'var(--cm-success)' : 'var(--cm-danger)';
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={`Retrieval boost ${up ? '+' : ''}${boost.toFixed(2)}`}
    >
      <span
        aria-hidden="true"
        className="relative inline-block h-2 w-16 overflow-hidden rounded-full"
        style={{ background: 'var(--cm-subtle)' }}
      >
        {/* centre tick */}
        <span
          className="absolute top-0 bottom-0"
          style={{ left: '50%', width: 1, background: 'var(--cm-border-strong)' }}
        />
        {/* diverging fill: anchored at the centre, growing toward its side */}
        <span
          className="absolute top-0 bottom-0"
          style={{
            background: ink,
            width: pct,
            ...(up ? { left: '50%' } : { right: '50%' }),
          }}
        />
      </span>
      <span className={up ? 'text-cm-success' : 'text-cm-danger'} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {up ? '+' : ''}{boost.toFixed(2)}
      </span>
    </span>
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
          <Link
            href={`/sources/view?path=${encodeURIComponent(source.path)}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2.5 py-1.5 text-sm text-cm-muted transition-colors hover:bg-cm-accent-soft hover:text-cm-fg"
            title="Open this file in the full source viewer"
          >
            Open in viewer <IconArrowRight size={14} />
          </Link>
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
