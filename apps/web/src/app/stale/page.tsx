'use client';

// Stale sources: a diagnostic view that lists manifest entries whose last
// successful ingest is older than a user-chosen threshold. The threshold is
// a small form that round-trips through the API; results are presented
// oldest first so the worst drift is at the top of the page.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, fmtBytes, fmtRelative, type StaleResult } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconClockCountdown,
  IconRefresh,
  IconArrowRight,
} from '@clawmind/ui';

export default function StalePage() {
  const [data, setData] = useState<StaleResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [limit, setLimit] = useState(200);

  const load = useCallback(async (opts: { olderThanDays: number; limit: number }) => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.staleList(opts));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load({ olderThanDays: 30, limit: 200 });
  }, [load]);

  function apply(e: React.FormEvent) {
    e.preventDefault();
    void load({ olderThanDays: Math.max(0, days | 0), limit: Math.max(1, limit | 0) });
  }

  const items = data?.items ?? [];

  return (
    <main className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Stale sources</h1>
            <p className="mt-1 text-sm text-cm-muted">
              Sources whose last successful ingest is older than the threshold below.
              Use this to spot files the watcher missed or paths that have drifted.
            </p>
          </div>
          <button
            onClick={() => void load({ olderThanDays: days, limit })}
            className="inline-flex items-center gap-1.5 self-start rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
          >
            <IconRefresh size={14} /> Refresh
          </button>
        </div>

        <form onSubmit={apply} className="mt-5 cm-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <IconClockCountdown size={16} /> Threshold
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <label className="flex flex-col gap-1 text-xs text-cm-muted">
              Older than (days)
              <input
                type="number"
                min={0}
                max={3650}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm text-cm-fg focus:outline-none focus:ring-2 focus:ring-cm-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-cm-muted">
              Limit
              <input
                type="number"
                min={1}
                max={5000}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm text-cm-fg focus:outline-none focus:ring-2 focus:ring-cm-accent"
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="self-end inline-flex items-center justify-center gap-1.5 rounded-md bg-cm-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? <Spinner size={14} /> : <IconRefresh size={14} />}
              Apply
            </button>
          </div>
          {data && (
            <p className="mt-3 text-xs text-cm-muted">
              {data.total} match{data.total === 1 ? '' : 'es'} older than {data.thresholdDays} day{data.thresholdDays === 1 ? '' : 's'}, scanned {fmtRelative(data.asOf)}.
            </p>
          )}
        </form>

        {error && (
          <div className="mt-4">
            <ErrorState message={error} onRetry={() => void load({ olderThanDays: days, limit })} />
          </div>
        )}

        <div className="mt-5">
          {loading && items.length === 0 ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : items.length === 0 ? (
            <EmptyState
              title="Nothing stale"
              body={`No sources older than ${data?.thresholdDays ?? days} day${(data?.thresholdDays ?? days) === 1 ? '' : 's'}. Lower the threshold to see more.`}
            />
          ) : (
            <ul className="cm-card divide-y divide-cm-border">
              {items.map((s) => (
                <li key={s.path} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <IconClockCountdown size={14} className="text-cm-accent" />
                      <Link
                        href={{ pathname: '/sources/view', query: { path: s.path } }}
                        className="truncate font-mono text-sm hover:underline"
                        title={s.path}
                      >
                        {s.path}
                      </Link>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-cm-muted">
                      <span>last ingest {fmtRelative(s.ingestedAt)}</span>
                      <span>{Math.round(s.ageDays)}d old</span>
                      <span>{s.chunkCount} chunk{s.chunkCount === 1 ? '' : 's'}</span>
                      <span>{fmtBytes(s.size)}</span>
                    </div>
                  </div>
                  <Link
                    href={{ pathname: '/sources/view', query: { path: s.path } }}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
                  >
                    <IconArrowRight size={14} /> Open
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
