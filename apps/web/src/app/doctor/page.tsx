'use client';

// Doctor: cross-store consistency report. Surfaces the same diagnostics the
// CLI prints (manifest vs BM25 vs LanceDB chunk counts, drift, empty docs,
// staleness) and exposes a guarded compaction flow for owners. Read path is
// safe to refresh; the compact action always previews via dryRun first so
// the destructive call only ever runs on numbers the user just looked at.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { TopNav } from '@/components/TopNav';
import { api, fmtRelative, type DoctorReport, type CompactReport } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconStethoscope,
  IconRefresh,
  IconWarning,
  IconCheck,
  IconArrowRight,
  IconTrash,
  IconDatabase,
} from '@clawmind/ui';

export default function DoctorPage() {
  const [data, setData] = useState<DoctorReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();
  const focus = params?.get('focus') ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.doctor());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <IconStethoscope size={22} /> Doctor
            </h1>
            <p className="mt-1 text-sm text-cm-muted">
              Cross-store consistency check across the manifest, BM25 index, and
              LanceDB. Re-run after large ingests or if results look off.
            </p>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 self-start rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg disabled:opacity-60"
          >
            {loading ? <Spinner /> : <IconRefresh size={14} />} Refresh
          </button>
        </div>

        {error && (
          <div className="mt-6">
            <ErrorState
              title="Could not run doctor"
              message={error}
              retryLabel="Try again"
              onRetry={() => void load()}
            />
          </div>
        )}

        {loading && !data && !error && (
          <div className="mt-10 flex items-center justify-center gap-2 text-sm text-cm-muted">
            <Spinner /> Running diagnostics
          </div>
        )}

        {data && (
          <>
            <StatusBanner ok={data.ok} ts={data.generatedAt} />
            <CountsGrid counts={data.counts} />
            <FindingsList findings={data.findings} focus={focus} />
            <CompactCard onChanged={() => void load()} />
          </>
        )}
      </div>
    </main>
  );
}

function StatusBanner({ ok, ts }: { ok: boolean; ts: number }) {
  return (
    <div
      className={[
        'mt-5 cm-card flex items-center justify-between gap-3 p-4',
        ok ? 'border-emerald-500/30' : 'border-amber-500/40',
      ].join(' ')}
    >
      <div className="flex items-center gap-2">
        {ok ? (
          <IconCheck size={18} className="text-emerald-500" />
        ) : (
          <IconWarning size={18} className="text-amber-500" />
        )}
        <span className="text-sm font-medium">
          {ok ? 'All stores look consistent.' : 'Findings need attention.'}
        </span>
      </div>
      <span className="text-xs text-cm-muted">checked {fmtRelative(ts)}</span>
    </div>
  );
}

function CountsGrid({ counts }: { counts: DoctorReport['counts'] }) {
  const cells: { label: string; value: number; href?: string }[] = [
    { label: 'Indexed files', value: counts.manifestDocs, href: '/sources' },
    { label: 'Manifest chunks', value: counts.manifestChunks },
    { label: 'BM25 chunks', value: counts.bm25Chunks },
    { label: 'LanceDB chunks', value: counts.lanceChunks },
  ];
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="cm-card p-3">
          <div className="text-[11px] uppercase tracking-wide text-cm-muted">{c.label}</div>
          <div className="mt-1 font-mono text-xl tabular-nums">{c.value.toLocaleString()}</div>
          {c.href && (
            <Link
              href={c.href}
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-cm-muted hover:text-cm-fg"
            >
              View <IconArrowRight size={11} />
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}

function FindingsList({ findings, focus }: { findings: DoctorReport['findings']; focus: string | null }) {
  // Group by severity so errors surface first regardless of API ordering.
  const order: Record<string, number> = { error: 0, warn: 1, info: 2 };
  const sorted = [...findings].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));

  const focusRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (focus && focusRef.current) {
      focusRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focus, sorted.length]);

  if (findings.length === 0) {
    return (
      <div className="mt-5">
        <EmptyState
          title="Nothing to flag"
          body="The manifest, BM25 index, and LanceDB are in sync and recent."
        />
      </div>
    );
  }

  return (
    <section className="mt-5">
      <h2 className="text-sm font-medium text-cm-muted">
        Findings ({findings.length})
      </h2>
      <ul className="mt-2 flex flex-col gap-2">
        {sorted.map((f, i) => {
          const isFocus = focus === f.code;
          return (
            <li
              key={`${f.code}-${i}`}
              ref={isFocus ? focusRef : undefined}
              className={[
                'cm-card p-4 transition-colors',
                isFocus ? 'ring-1 ring-cm-accent' : '',
              ].join(' ')}
            >
            <div className="flex items-start gap-3">
              <SeverityChip severity={f.severity} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-xs text-cm-muted">{f.code}</span>
                  <span className="text-sm font-medium">{f.message}</span>
                </div>
                {f.hint && (
                  <p className="mt-1 text-sm text-cm-muted">{f.hint}</p>
                )}
                {hintAction(f.code)}
              </div>
            </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SeverityChip({ severity }: { severity: 'info' | 'warn' | 'error' }) {
  const map = {
    error: 'bg-red-500/10 text-red-500 border-red-500/30',
    warn: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
    info: 'bg-sky-500/10 text-sky-500 border-sky-500/30',
  } as const;
  const label = severity.toUpperCase();
  return (
    <span
      className={[
        'inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[10px] font-medium tracking-wide',
        map[severity],
      ].join(' ')}
    >
      {label}
    </span>
  );
}

function hintAction(code: string): React.ReactNode {
  switch (code) {
    case 'EMPTY_INDEX':
      return (
        <Link
          href="/ingest"
          className="mt-2 inline-flex items-center gap-1 text-xs text-cm-muted hover:text-cm-fg"
        >
          <IconDatabase size={12} /> Open ingest <IconArrowRight size={11} />
        </Link>
      );
    case 'STALE_INDEX':
      return (
        <Link
          href="/stale"
          className="mt-2 inline-flex items-center gap-1 text-xs text-cm-muted hover:text-cm-fg"
        >
          View stale sources <IconArrowRight size={11} />
        </Link>
      );
    case 'BM25_DRIFT':
    case 'LANCE_DRIFT':
    case 'EMPTY_DOCS':
      return (
        <span className="mt-2 inline-flex items-center gap-1 text-xs text-cm-muted">
          Use the compaction tool below for missing-file cleanup.
        </span>
      );
    default:
      return null;
  }
}

type CompactState =
  | { kind: 'idle' }
  | { kind: 'previewing' }
  | { kind: 'preview'; report: CompactReport }
  | { kind: 'applying' }
  | { kind: 'applied'; report: CompactReport }
  | { kind: 'error'; message: string };

function CompactCard({ onChanged }: { onChanged: () => void }) {
  const [state, setState] = useState<CompactState>({ kind: 'idle' });

  async function preview() {
    setState({ kind: 'previewing' });
    try {
      const report = await api.maintenanceCompact(true);
      setState({ kind: 'preview', report });
    } catch (err) {
      setState({ kind: 'error', message: (err as Error).message });
    }
  }

  async function apply() {
    setState({ kind: 'applying' });
    try {
      const report = await api.maintenanceCompact(false);
      setState({ kind: 'applied', report });
      onChanged();
    } catch (err) {
      setState({ kind: 'error', message: (err as Error).message });
    }
  }

  return (
    <section className="mt-6 cm-card p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <IconTrash size={16} /> Compact index
      </div>
      <p className="mt-1 text-sm text-cm-muted">
        Drops manifest, BM25, and LanceDB entries for source files that no
        longer exist on disk. Owner-only. Always previews first so you can
        confirm the count before anything is removed.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void preview()}
          disabled={state.kind === 'previewing' || state.kind === 'applying'}
          className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm hover:bg-cm-accent-soft disabled:opacity-60"
        >
          {state.kind === 'previewing' ? <Spinner /> : <IconRefresh size={14} />}
          Preview
        </button>

        {state.kind === 'preview' && state.report.removed > 0 && (
          <button
            onClick={() => void apply()}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/20"
          >
            <IconTrash size={14} /> Remove {state.report.removed} stale{' '}
            {state.report.removed === 1 ? 'entry' : 'entries'}
          </button>
        )}

        {state.kind === 'applying' && (
          <span className="inline-flex items-center gap-2 text-sm text-cm-muted">
            <Spinner /> Compacting
          </span>
        )}
      </div>

      {state.kind === 'preview' && (
        <CompactSummary report={state.report} kind="preview" />
      )}
      {state.kind === 'applied' && (
        <CompactSummary report={state.report} kind="applied" />
      )}
      {state.kind === 'error' && (
        <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {state.message}
        </p>
      )}
    </section>
  );
}

function CompactSummary({
  report,
  kind,
}: {
  report: CompactReport;
  kind: 'preview' | 'applied';
}) {
  const removed = report.removed;
  if (removed === 0) {
    return (
      <p className="mt-3 text-sm text-cm-muted">
        Scanned {report.scanned.toLocaleString()} entries. Nothing to remove.
      </p>
    );
  }
  return (
    <div className="mt-3">
      <p className="text-sm">
        {kind === 'preview' ? 'Would remove ' : 'Removed '}
        <span className="font-mono">{removed}</span> of{' '}
        <span className="font-mono">{report.scanned}</span> entries
        {kind === 'preview' && '. Review the paths below before applying.'}
      </p>
      {report.removedPaths && report.removedPaths.length > 0 && (
        <ul className="mt-2 max-h-56 overflow-auto rounded-md border border-cm-border bg-cm-bg-elev p-2 font-mono text-xs">
          {report.removedPaths.slice(0, 200).map((p) => (
            <li key={p} className="truncate text-cm-muted">
              {p}
            </li>
          ))}
          {report.removedPaths.length > 200 && (
            <li className="mt-1 text-[11px] text-cm-muted">
              and {report.removedPaths.length - 200} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
