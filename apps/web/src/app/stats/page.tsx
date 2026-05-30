'use client';
import { useEffect, useState } from 'react';
import { TopNav } from '@/components/TopNav';
import { api, fmtBytes, fmtRelative, type StatsReport } from '@/lib/api';
import { EmptyState, ErrorState, Spinner, IconRefresh, IconDatabase } from '@clawmind/ui';

export default function StatsPage() {
  const [stats, setStats] = useState<StatsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const maxChunks = stats ? Math.max(1, ...stats.byNamespace.map((n) => n.chunks)) : 1;

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
              <Stat label="Files" value={stats.totals.files.toLocaleString()} />
              <Stat label="Chunks" value={stats.totals.chunks.toLocaleString()} />
              <Stat label="Indexed bytes" value={fmtBytes(stats.totals.bytes)} />
              <Stat label="Namespaces" value={String(stats.totals.namespaces)} />
            </div>

            <div className="mt-6 cm-card">
              <div className="flex items-center justify-between border-b border-cm-border px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <IconDatabase size={16} />
                  By namespace
                </div>
                <div className="text-xs text-cm-muted">Generated {fmtRelative(stats.generatedAt)}</div>
              </div>
              <div className="divide-y divide-cm-border">
                {stats.byNamespace.map((ns) => (
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
                          className="h-full rounded-full bg-cm-accent"
                          style={{ width: `${Math.round((ns.chunks / maxChunks) * 100)}%` }}
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
                      <div className="text-sm font-medium">{ns.chunks.toLocaleString()}</div>
                      <div className="text-xs text-cm-muted">chunks</div>
                      <div className="mt-1 text-[11px] text-cm-muted">
                        oldest {fmtRelative(ns.oldestIngestedAt)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="cm-card p-4">
      <div className="text-xs uppercase tracking-wide text-cm-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}
