'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  // Quota bar tints stay inside the warm palette: accent at rest, citation
  // gold as the "getting close" caution, danger red once the cap is hit.
  const barColor = overLimit
    ? 'var(--cm-danger)'
    : nearLimit
      ? 'var(--cm-cite)'
      : 'var(--cm-accent)';

  // Ask-vs-search split for the request-mix bar. The page previously showed
  // the two counts as bare numbers; the proportion turns them into a shape.
  const mix = useMemo(() => {
    if (!data) return null;
    const ask = Math.max(0, data.byKind.ask);
    const search = Math.max(0, data.byKind.search);
    const total = ask + search;
    return { ask, search, total };
  }, [data]);

  return (
    <div className="min-h-screen">
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg disabled:opacity-50"
            aria-label="Refresh usage"
          >
            <IconRefresh size={14} />
            Refresh
          </button>
        </div>

        {loading && !data ? (
          <div className="cm-card p-6">
            <div className="flex items-center gap-2 text-sm text-cm-muted">
              <Spinner /> Loading usage
            </div>
            <div className="mt-4 h-3 w-full animate-pulse rounded-full bg-cm-subtle" />
            <div className="mt-3 h-4 w-32 animate-pulse rounded bg-cm-subtle" />
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
            <section className="cm-card p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="text-sm text-cm-muted">
                    {data.plan === 'free' ? 'Free plan' : data.plan} · {data.period}
                  </div>
                  <div className="mt-1 text-3xl font-semibold tabular-nums">
                    {data.used.toLocaleString()}{' '}
                    <span className="text-base font-normal text-cm-muted">
                      / {data.limit.toLocaleString()} requests
                    </span>
                  </div>
                </div>
                <div className="text-right text-sm text-cm-muted">
                  <div>Resets in {fmtResetIn(data.resetsAt)}</div>
                  <div className="text-xs">{fmtResetDate(data.resetsAt)}</div>
                </div>
              </div>

              <div
                className="mt-5 h-3 w-full overflow-hidden rounded-full bg-cm-subtle"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={data.limit}
                aria-valuenow={data.used}
                aria-label={`Used ${data.used} of ${data.limit} requests`}
              >
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${pct}%`, background: barColor }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-cm-muted">
                <span>{fmtPct(data.used, data.limit)} used</span>
                <span>{data.remaining.toLocaleString()} left</span>
              </div>

              {nearLimit ? (
                <div
                  className="mt-4 flex items-start gap-2 rounded-lg border p-3 text-sm"
                  style={{
                    borderColor: overLimit ? 'var(--cm-danger)' : 'var(--cm-cite-line)',
                    background: overLimit ? 'rgba(180, 66, 60, 0.08)' : 'var(--cm-cite-bg)',
                  }}
                >
                  <span style={{ color: overLimit ? 'var(--cm-danger)' : 'var(--cm-cite)' }}>
                    <IconWarning size={16} />
                  </span>
                  <div>
                    {overLimit
                      ? 'You have hit the free tier limit. New ask and search requests will return 429 until the quota resets.'
                      : 'You are close to the free tier limit. Upgrade to keep things running smoothly.'}
                  </div>
                </div>
              ) : null}
            </section>

            <section className="mt-6 cm-card p-6">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-medium">Request mix</h2>
                <span className="text-xs text-cm-muted tabular-nums">
                  {mix && mix.total > 0 ? `${mix.total.toLocaleString()} this period` : 'nothing yet'}
                </span>
              </div>
              {mix && mix.total > 0 ? (
                <>
                  <div
                    className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-cm-subtle"
                    role="img"
                    aria-label={`${mix.ask} ask and ${mix.search} search requests`}
                  >
                    <div
                      className="h-full transition-all duration-300"
                      style={{ width: `${(mix.ask / mix.total) * 100}%`, background: 'var(--cm-accent)' }}
                    />
                    <div
                      className="h-full transition-all duration-300"
                      style={{ width: `${(mix.search / mix.total) * 100}%`, background: 'var(--cm-cite)' }}
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-4">
                    <MixLegend
                      swatch="var(--cm-accent)"
                      label="Ask"
                      value={mix.ask}
                      total={mix.total}
                      sub="Answered questions"
                    />
                    <MixLegend
                      swatch="var(--cm-cite)"
                      label="Search"
                      value={mix.search}
                      total={mix.total}
                      sub="Retrieval queries"
                    />
                  </div>
                </>
              ) : (
                <p className="mt-3 text-sm text-cm-muted">
                  Ask a question or run a search and the split shows up here.
                </p>
              )}
            </section>

            <section className="mt-6 cm-card p-6">
              <h2 className="text-base font-semibold">Need more headroom?</h2>
              <p className="mt-1 text-sm text-cm-muted">
                ClawMind runs locally and the free tier covers most personal
                workloads. If you bump into the limit, set
                {' '}
                <code className="rounded bg-cm-subtle px-1 py-0.5 text-xs">
                  CLAWMIND_FREE_LIMIT
                </code>
                {' '}
                on your server to raise it, or get in touch about a Team plan.
              </p>
              <a
                href="mailto:hello@clawmind.dev?subject=Upgrade%20interest"
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium text-white hover:opacity-90"
                style={{ background: 'var(--cm-accent)' }}
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

/**
 * One side of the request-mix legend: a colour swatch matching its bar
 * segment, the count, its share of the total, and a one-line descriptor.
 */
function MixLegend({
  swatch,
  label,
  value,
  total,
  sub,
}: {
  swatch: string;
  label: string;
  value: number;
  total: number;
  sub: string;
}) {
  const share = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-start gap-2.5">
      <span
        aria-hidden="true"
        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: swatch }}
      />
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tabular-nums">{value.toLocaleString()}</span>
          <span className="text-xs text-cm-muted tabular-nums">{share}%</span>
        </div>
        <div className="text-xs text-cm-muted">
          {label} · {sub}
        </div>
      </div>
    </div>
  );
}
