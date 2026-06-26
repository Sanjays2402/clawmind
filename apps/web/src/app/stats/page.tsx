'use client';
import { useEffect, useMemo, useState } from 'react';
import { TopNav } from '@/components/TopNav';
import { api, fmtBytes, fmtRelative, type StatsReport, type NamespaceStats } from '@/lib/api';
import { EmptyState, ErrorState, Spinner, IconRefresh, IconDatabase } from '@clawmind/ui';
import { NamespaceDonut } from '@/components/NamespaceDonut';

type Metric = 'files' | 'chunks' | 'bytes';

const METRICS: { id: Metric; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'chunks', label: 'Chunks' },
  { id: 'bytes', label: 'Bytes' },
];

function metricValue(ns: NamespaceStats, metric: Metric): number {
  return metric === 'files' ? ns.files : metric === 'chunks' ? ns.chunks : ns.bytes;
}

function fmtMetric(value: number, metric: Metric): string {
  return metric === 'bytes' ? fmtBytes(value) : value.toLocaleString();
}

export default function StatsPage() {
  const [stats, setStats] = useState<StatsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which metric the per-namespace bar visualisation ranks + scales by.
  const [metric, setMetric] = useState<Metric>('chunks');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setStats(await api.stats());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // Sort namespaces by the selected metric (desc) so the heaviest namespace
  // for whichever lens you pick always sits at the top, and scale every bar to
  // that metric's max so the longest bar is full-width. Recomputed only when
  // the data or the chosen metric changes.
  const ranked = useMemo(() => {
    if (!stats) return [];
    return [...stats.byNamespace].sort((a, b) => metricValue(b, metric) - metricValue(a, metric));
  }, [stats, metric]);
  const maxVal = useMemo(
    () => Math.max(1, ...ranked.map((n) => metricValue(n, metric))),
    [ranked, metric],
  );
  // Human label for the active metric, shared by the donut card header + aria.
  const metricLabel = METRICS.find((m) => m.id === metric)?.label ?? 'Chunks';

  return (
    <main className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Index stats</h1>
            <p className="mt-1 text-sm text-cm-muted">
              How much of your workspace is currently searchable, grouped by namespace.
            </p>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 self-start rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
          >
            <IconRefresh size={14} /> Refresh
          </button>
        </div>

        {loading && !stats ? (
          <div className="mt-12 flex justify-center"><Spinner /></div>
        ) : error ? (
          <div className="mt-8"><ErrorState message={error} onRetry={load} /></div>
        ) : !stats || stats.totals.files === 0 ? (
          <div className="mt-8">
            <EmptyState
              title="Nothing indexed yet"
              body="Run an ingest from the Ingest tab to populate stats."
            />
          </div>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Files" value={stats.totals.files.toLocaleString()} active={metric === 'files'} onClick={() => setMetric('files')} />
              <Stat label="Chunks" value={stats.totals.chunks.toLocaleString()} active={metric === 'chunks'} onClick={() => setMetric('chunks')} />
              <Stat label="Indexed bytes" value={fmtBytes(stats.totals.bytes)} active={metric === 'bytes'} onClick={() => setMetric('bytes')} />
              <Stat label="Namespaces" value={String(stats.totals.namespaces)} />
            </div>

            {ranked.length > 1 && (
              <div className="mt-6 cm-card">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cm-border px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <IconDatabase size={16} />
                    Share of {metricLabel.toLowerCase()}
                  </div>
                  <div className="text-xs text-cm-muted">
                    Each namespace as a slice of the whole index
                  </div>
                </div>
                <NamespaceDonut
                  data={ranked.map((ns) => ({ key: ns.namespace, value: metricValue(ns, metric) }))}
                  metricLabel={metricLabel}
                  formatValue={(v) => fmtMetric(v, metric)}
                />
              </div>
            )}

            <div className="mt-6 cm-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cm-border px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <IconDatabase size={16} />
                  By namespace
                </div>
                <div className="flex items-center gap-3">
                  <MetricToggle metric={metric} onChange={setMetric} />
                  <div className="text-xs text-cm-muted">Generated {fmtRelative(stats.generatedAt)}</div>
                </div>
              </div>
              <div className="divide-y divide-cm-border">
                {ranked.map((ns) => {
                  const val = metricValue(ns, metric);
                  const pct = Math.round((val / maxVal) * 100);
                  return (
                    <div key={ns.namespace} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[1fr_2fr_auto] sm:items-center">
                      <div>
                        <div className="font-mono text-sm">{ns.namespace}</div>
                        <div className="mt-0.5 text-xs text-cm-muted">
                          {ns.files} files, {fmtBytes(ns.bytes)}
                        </div>
                      </div>
                      <div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-cm-bg">
                          <div
                            className="h-full rounded-full bg-cm-accent transition-all duration-300"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {ns.extensions.slice(0, 6).map((e) => (
                            <span key={e.ext} className="rounded bg-cm-bg px-1.5 py-0.5 text-[11px] text-cm-muted">
                              {e.ext} {e.count}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium tabular-nums">{fmtMetric(val, metric)}</div>
                        <div className="text-xs text-cm-muted">{metric}</div>
                        <div className="mt-1 text-[11px] text-cm-muted">
                          oldest {fmtRelative(ns.oldestIngestedAt)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

/**
 * Segmented control that picks which metric the namespace bars rank + scale
 * by. Three tight pills sharing one bordered shell; the active pill carries
 * the accent-soft treatment.
 */
function MetricToggle({ metric, onChange }: { metric: Metric; onChange: (m: Metric) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Rank namespaces by"
      className="inline-flex items-center rounded-md border border-cm-border p-0.5"
    >
      {METRICS.map((m) => {
        const active = m.id === metric;
        return (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(m.id)}
            className={[
              'rounded px-2 py-1 text-xs transition-colors',
              active ? 'bg-cm-accent-soft text-cm-fg' : 'text-cm-muted hover:text-cm-fg',
            ].join(' ')}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function Stat({ label, value, active, onClick }: { label: string; value: string; active?: boolean; onClick?: () => void }) {
  if (!onClick) {
    return (
      <div className="cm-card p-4">
        <div className="text-xs uppercase tracking-wide text-cm-muted">{label}</div>
        <div className="mt-1 text-xl font-semibold">{value}</div>
      </div>
    );
  }
  // Clickable stat cards double as a shortcut to rank the namespace bars by
  // that total. The active card gets an accent ring so the link between the
  // card you clicked and the bars below is visible.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`Rank namespaces by ${label.toLowerCase()}`}
      className={[
        'cm-card p-4 text-left transition-colors',
        active ? 'ring-1 ring-cm-accent-line' : 'hover:border-cm-border-strong',
      ].join(' ')}
    >
      <div className="text-xs uppercase tracking-wide text-cm-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </button>
  );
}
