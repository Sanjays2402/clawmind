'use client';

// Feedback: per-source upvote and downvote tally. The vote map shapes
// retrieval ranking, so this page is the operator view for inspecting and
// resetting consensus on a path. Mutations call DELETE /v1/feedback.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, fmtRelative, type FeedbackEntry } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconThumbsUp,
  IconThumbsDown,
  IconRefresh,
  IconTrash,
  IconArrowRight,
  IconSearch,
} from '@clawmind/ui';

type SortKey = 'boost' | 'ups' | 'downs' | 'updated';

export default function FeedbackPage() {
  const [items, setItems] = useState<FeedbackEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<SortKey>('boost');
  const [clearing, setClearing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.feedbackList());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function clearVote(path: string) {
    if (!confirm(`Clear all votes on ${path}?`)) return;
    setClearing(path);
    try {
      await api.feedbackClear(path);
      setItems((cur) => cur.filter((it) => it.path !== path));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setClearing(null);
    }
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const arr = q ? items.filter((it) => it.path.toLowerCase().includes(q)) : items.slice();
    arr.sort((a, b) => {
      switch (sort) {
        case 'ups': return b.ups - a.ups;
        case 'downs': return b.downs - a.downs;
        case 'updated': return b.updatedAt - a.updatedAt;
        case 'boost':
        default: return b.boost - a.boost;
      }
    });
    return arr;
  }, [items, filter, sort]);

  const totals = useMemo(() => {
    let ups = 0, downs = 0;
    for (const it of items) { ups += it.ups; downs += it.downs; }
    return { ups, downs };
  }, [items]);

  return (
    <main className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Source feedback</h1>
            <p className="mt-1 text-sm text-cm-muted">
              Votes adjust how a source ranks during retrieval. A positive boost lifts a path, negative pushes it down. Clearing a row resets it to neutral.
            </p>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 self-start rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
          >
            <IconRefresh size={14} /> Refresh
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="cm-card p-4">
            <div className="text-xs uppercase tracking-wide text-cm-muted">Tracked paths</div>
            <div className="mt-1 text-2xl font-semibold">{items.length}</div>
          </div>
          <div className="cm-card p-4">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-cm-muted">
              <IconThumbsUp size={12} /> Upvotes
            </div>
            <div className="mt-1 text-2xl font-semibold">{totals.ups}</div>
          </div>
          <div className="cm-card p-4">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-cm-muted">
              <IconThumbsDown size={12} /> Downvotes
            </div>
            <div className="mt-1 text-2xl font-semibold">{totals.downs}</div>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative flex-1">
            <IconSearch size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cm-muted" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by path"
              className="w-full rounded-md border border-cm-border bg-cm-bg py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-cm-accent"
            />
          </label>
          <div className="flex items-center gap-1 rounded-md border border-cm-border p-1 text-xs">
            {(['boost', 'ups', 'downs', 'updated'] as SortKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setSort(k)}
                className={[
                  'rounded px-2 py-1 capitalize transition-colors',
                  sort === k ? 'bg-cm-accent-soft text-cm-fg' : 'text-cm-muted hover:text-cm-fg',
                ].join(' ')}
              >{k}</button>
            ))}
          </div>
        </div>

        {error && (
          <div className="mt-4">
            <ErrorState message={error} onRetry={() => setError(null)} retryLabel="Dismiss" />
          </div>
        )}

        <div className="mt-5">
          {loading && items.length === 0 ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : items.length === 0 ? (
            <EmptyState
              title="No feedback yet"
              body="Vote on a source from Chat or Search results to start shaping retrieval rankings here."
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No matches"
              body={`Nothing matches "${filter}". Clear the filter to see all ${items.length} tracked paths.`}
            />
          ) : (
            <ul className="cm-card divide-y divide-cm-border">
              {filtered.map((f) => {
                const boostClass = f.boost > 0
                  ? 'text-emerald-500'
                  : f.boost < 0
                    ? 'text-cm-danger'
                    : 'text-cm-muted';
                return (
                  <li key={f.path} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={{ pathname: '/sources/view', query: { path: f.path } }}
                        className="block truncate font-mono text-sm hover:underline"
                        title={f.path}
                      >
                        {f.path}
                      </Link>
                      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-cm-muted">
                        <span className="inline-flex items-center gap-1">
                          <IconThumbsUp size={12} /> {f.ups}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <IconThumbsDown size={12} /> {f.downs}
                        </span>
                        <span className={`font-medium ${boostClass}`}>
                          boost {f.boost > 0 ? '+' : ''}{f.boost.toFixed(2)}
                        </span>
                        <span>updated {fmtRelative(f.updatedAt)}</span>
                      </div>
                      <VoteRatioBar ups={f.ups} downs={f.downs} />
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Link
                        href={{ pathname: '/sources/view', query: { path: f.path } }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm hover:text-cm-fg"
                      >
                        <IconArrowRight size={14} /> Open
                      </Link>
                      <button
                        onClick={() => clearVote(f.path)}
                        disabled={clearing === f.path}
                        className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2 py-1.5 text-sm text-cm-muted hover:text-cm-danger disabled:opacity-50"
                        title="Clear votes"
                      >
                        {clearing === f.path ? <Spinner size={14} /> : <IconTrash size={14} />}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}

/**
 * A thin split mini-bar showing each source's up/down distribution at a
 * glance: green to the left for upvotes, danger to the right for downs, sized
 * by share. The page's three top cards and the per-row counts say how MANY
 * votes; this turns the ratio into a shape so a dominantly-down path reads as
 * red-heavy without parsing the numbers. Pure agreement collapses to one
 * solid band. Skipped entirely when a row has no votes.
 */
function VoteRatioBar({ ups, downs }: { ups: number; downs: number }) {
  const total = ups + downs;
  if (total === 0) return null;
  const upPct = Math.round((ups / total) * 100);
  return (
    <div className="mt-2 flex items-center gap-2">
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-cm-bg"
        role="img"
        aria-label={`${ups} up, ${downs} down (${upPct}% positive)`}
      >
        <div className="flex h-full w-full">
          {ups > 0 && (
            <div className="h-full bg-emerald-500/80 transition-all duration-300" style={{ width: `${upPct}%` }} />
          )}
          {downs > 0 && (
            <div className="h-full bg-cm-danger/80 transition-all duration-300" style={{ width: `${100 - upPct}%` }} />
          )}
        </div>
      </div>
      <span className="shrink-0 tabular-nums text-[11px] text-cm-muted">{upPct}%</span>
    </div>
  );
}
