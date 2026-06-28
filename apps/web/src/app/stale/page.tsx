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

  // Turn the raw age numbers into a scannable shape. Severity is measured
  // relative to the user's own threshold (not an absolute day count), so a
  // source 4x past a 7-day threshold reads as urgently as one 4x past 90 days.
  // The drift bar for each row is scaled to the oldest item in the current
  // result set so the worst offender is always full-width and the rest read
  // proportionally against it.
  const maxAge = items.reduce((m, s) => Math.max(m, s.ageDays), 0) || 1;
  const thr = data?.thresholdDays ?? days;
  function severity(ageDays: number): 'mild' | 'moderate' | 'severe' {
    const ratio = thr > 0 ? ageDays / thr : 1;
    if (ratio >= 4) return 'severe';
    if (ratio >= 2) return 'moderate';
    return 'mild';
  }
  const sevColor: Record<'mild' | 'moderate' | 'severe', string> = {
    mild: 'var(--cm-accent)',
    moderate: 'var(--cm-cite)',
    severe: 'var(--cm-danger)',
  };
  // Count the severely-drifted (>=4x threshold) sources for the summary chip:
  // these are the ones most likely to be genuinely missing from the index
  // rather than just quietly aging, so they earn a callout.
  const severeCount = items.filter((s) => severity(s.ageDays) === 'severe').length;

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
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-cm-muted">
              <span>
                {data.total} match{data.total === 1 ? '' : 'es'} older than {data.thresholdDays} day{data.thresholdDays === 1 ? '' : 's'}, scanned {fmtRelative(data.asOf)}.
              </span>
              {severeCount > 0 && (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-cm-danger/40 px-2 py-0.5 font-medium text-cm-danger"
                  style={{ background: 'rgba(180, 66, 60, 0.10)' }}
                  title={`${severeCount} source${severeCount === 1 ? '' : 's'} at least 4x past the threshold — likely missing from the index, not just aging`}
                >
                  {severeCount} severely drifted
                </span>
              )}
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
              {items.map((s) => {
                const sev = severity(s.ageDays);
                const barPct = Math.max(3, Math.round((s.ageDays / maxAge) * 100));
                return (
                <li key={s.path} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <IconClockCountdown size={14} style={{ color: sevColor[sev] }} />
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
                      <span style={{ color: sevColor[sev] }}>{Math.round(s.ageDays)}d old</span>
                      <span>{s.chunkCount} chunk{s.chunkCount === 1 ? '' : 's'}</span>
                      <span>{fmtBytes(s.size)}</span>
                    </div>
                    {/* Drift bar: width = this source's age as a share of the
                        oldest in the set, color = severity vs the threshold.
                        Gives the list a left-to-right "how bad" silhouette so
                        the worst drift is obvious without reading the numbers. */}
                    <div
                      className="mt-2 h-1 w-full max-w-xs overflow-hidden rounded-full bg-cm-subtle"
                      role="img"
                      aria-label={`${Math.round(s.ageDays)} days old, ${sev} drift`}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${barPct}%`, background: sevColor[sev] }}
                      />
                    </div>
                  </div>
                  <Link
                    href={{ pathname: '/sources/view', query: { path: s.path } }}
                    className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg sm:self-center"
                  >
                    <IconArrowRight size={14} /> Open
                  </Link>
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
