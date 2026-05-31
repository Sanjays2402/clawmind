'use client';
import { useCallback, useEffect, useState } from 'react';
import { TopNav } from '@/components/TopNav';
import { api, type UsageSummary } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconChartBar,
  IconRefresh,
  IconWarning,
  IconArrowRight,
} from '@clawmind/ui';

function fmtPct(used: number, limit: number): string {
  if (limit <= 0) return '0%';
  return `${Math.min(100, Math.round((used / limit) * 100))}%`;
}

function fmtResetIn(resetsAt: number): string {
  const ms = resetsAt - Date.now();
  if (ms <= 0) return 'soon';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}h ${mins}m`;
}

function fmtResetDate(resetsAt: number): string {
  return new Date(resetsAt).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export default function UsagePage() {
  const [data, setData] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.usage());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const pct = data ? Math.min(100, (data.used / Math.max(1, data.limit)) * 100) : 0;
  const nearLimit = data ? data.used / Math.max(1, data.limit) >= 0.8 : false;
  const overLimit = data ? data.used >= data.limit : false;
  const barColor = overLimit
    ? 'bg-red-500'
    : nearLimit
      ? 'bg-amber-500'
      : 'bg-violet-500';

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <TopNav />
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconChartBar size={22} />
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Usage</h1>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--fg-muted)] hover:bg-[var(--bg-elev)] disabled:opacity-50"
            aria-label="Refresh usage"
          >
            <IconRefresh size={14} />
            Refresh
          </button>
        </div>

        {loading && !data ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-6">
            <div className="flex items-center gap-2 text-sm text-[var(--fg-muted)]">
              <Spinner /> Loading usage
            </div>
            <div className="mt-4 h-3 w-full animate-pulse rounded-full bg-[var(--border)]" />
            <div className="mt-3 h-4 w-32 animate-pulse rounded bg-[var(--border)]" />
          </div>
        ) : error ? (
          <ErrorState title="Could not load usage" message={error} onRetry={load} />
        ) : !data ? (
          <EmptyState
            title="No usage yet"
            body="Run a search or ask a question to start tracking usage."
          />
        ) : (
          <>
            <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="text-sm text-[var(--fg-muted)]">
                    {data.plan === 'free' ? 'Free plan' : data.plan} · {data.period}
                  </div>
                  <div className="mt-1 text-3xl font-semibold tabular-nums">
                    {data.used.toLocaleString()}{' '}
                    <span className="text-base font-normal text-[var(--fg-muted)]">
                      / {data.limit.toLocaleString()} requests
                    </span>
                  </div>
                </div>
                <div className="text-right text-sm text-[var(--fg-muted)]">
                  <div>Resets in {fmtResetIn(data.resetsAt)}</div>
                  <div className="text-xs">{fmtResetDate(data.resetsAt)}</div>
                </div>
              </div>

              <div
                className="mt-5 h-3 w-full overflow-hidden rounded-full bg-[var(--border)]"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={data.limit}
                aria-valuenow={data.used}
                aria-label={`Used ${data.used} of ${data.limit} requests`}
              >
                <div
                  className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-[var(--fg-muted)]">
                <span>{fmtPct(data.used, data.limit)} used</span>
                <span>{data.remaining.toLocaleString()} left</span>
              </div>

              {nearLimit ? (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  <IconWarning size={16} />
                  <div>
                    {overLimit
                      ? 'You have hit the free tier limit. New ask and search requests will return 429 until the quota resets.'
                      : 'You are close to the free tier limit. Upgrade to keep things running smoothly.'}
                  </div>
                </div>
              ) : null}
            </section>

            <section className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-5">
                <div className="text-xs uppercase tracking-wide text-[var(--fg-muted)]">
                  Ask
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {data.byKind.ask.toLocaleString()}
                </div>
                <div className="mt-1 text-xs text-[var(--fg-muted)]">
                  Answered questions this period
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-5">
                <div className="text-xs uppercase tracking-wide text-[var(--fg-muted)]">
                  Search
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {data.byKind.search.toLocaleString()}
                </div>
                <div className="mt-1 text-xs text-[var(--fg-muted)]">
                  Retrieval queries this period
                </div>
              </div>
            </section>

            <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-6">
              <h2 className="text-base font-semibold">Need more headroom?</h2>
              <p className="mt-1 text-sm text-[var(--fg-muted)]">
                ClawMind runs locally and the free tier covers most personal
                workloads. If you bump into the limit, set
                {' '}
                <code className="rounded bg-[var(--border)] px-1 py-0.5 text-xs">
                  CLAWMIND_FREE_LIMIT
                </code>
                {' '}
                on your server to raise it, or get in touch about a Team plan.
              </p>
              <a
                href="mailto:hello@clawmind.dev?subject=Upgrade%20interest"
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-700"
              >
                Talk to us about upgrading
                <IconArrowRight size={14} />
              </a>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
