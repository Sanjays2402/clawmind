'use client';
// Procurement Security Posture page.
//
// Single screen a buyer's compliance reviewer can screenshot for their
// vendor risk register. Every row is derived from a live service, not
// editable text, so the report cannot be over-stated. JSON export is a
// single button because procurement automation invariably wants the
// raw payload to feed into a SOC2 / ISO 27001 questionnaire tool.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, ApiError, fmtRelative, type PostureReport } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconShield,
  IconCheck,
  IconWarning,
  IconRefresh,
  IconDownload,
  IconArrowRight,
} from '@clawmind/ui';

function StatusDot({ status }: { status: 'pass' | 'warn' | 'fail' }) {
  const cls =
    status === 'pass'
      ? 'bg-emerald-500'
      : status === 'warn'
        ? 'bg-amber-500'
        : 'bg-rose-500';
  return <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${cls}`} />;
}

function StatusBadge({ status }: { status: 'pass' | 'warn' | 'fail' }) {
  const label = status === 'pass' ? 'pass' : status === 'warn' ? 'warn' : 'fail';
  const cls =
    status === 'pass'
      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
      : status === 'warn'
        ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30'
        : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30';
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

export default function PosturePage() {
  const [data, setData] = useState<PostureReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.posture();
      setData(r);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'failed to load posture');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function download() {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clawmind-posture-${new Date(data.generatedAt).toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const scoreTone =
    data == null
      ? 'text-[var(--muted)]'
      : data.score >= 90
        ? 'text-emerald-600 dark:text-emerald-400'
        : data.score >= 70
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-rose-600 dark:text-rose-400';

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <TopNav />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <IconShield size={22} />
            <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Security posture</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--card)]"
              disabled={loading}
            >
              <IconRefresh size={14} /> Refresh
            </button>
            <button
              onClick={download}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--card)] disabled:opacity-50"
              disabled={!data}
            >
              <IconDownload size={14} /> Export JSON
            </button>
          </div>
        </div>

        <p className="mb-5 text-sm text-[var(--muted)]">
          Live, derived security posture across every workspace control. Paste this
          into a vendor security questionnaire or feed the JSON into your risk
          register. Distinct from the admin overview (operator counters) and the
          Trust Center (editable marketing).
        </p>

        {loading && !data ? (
          <div className="flex items-center justify-center py-12">
            <Spinner />
          </div>
        ) : err ? (
          <ErrorState message={err} onRetry={() => void load()} />
        ) : !data ? (
          <EmptyState title="No data" body="Posture report unavailable." />
        ) : (
          <>
            <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
                <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Score</div>
                <div className={`mt-1 text-2xl font-semibold tabular-nums ${scoreTone}`}>{data.score}</div>
                <div className="mt-1 text-xs text-[var(--muted)]">{data.ready ? 'Procurement-ready' : 'Action required'}</div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
                <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Pass</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{data.counts.pass}</div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
                <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Warn</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">{data.counts.warn}</div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
                <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Fail</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-rose-600 dark:text-rose-400">{data.counts.fail}</div>
              </div>
            </section>

            <div className="mb-3 text-xs text-[var(--muted)]">
              Generated {fmtRelative(data.generatedAt)}
            </div>

            <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
              {data.controls.map((c) => (
                <li key={c.id} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusDot status={c.status} />
                    <span className="text-sm font-semibold">{c.title}</span>
                    <StatusBadge status={c.status} />
                    <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{c.family}</span>
                  </div>
                  <div className="mt-1.5 text-sm text-[var(--fg)]">{c.detail}</div>
                  {c.remediation ? (
                    <div className="mt-1.5 flex items-start gap-1.5 text-xs text-[var(--muted)]">
                      <IconArrowRight size={12} className="mt-0.5 shrink-0" />
                      <span className="break-all">{c.remediation}</span>
                    </div>
                  ) : (
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                      <IconCheck size={12} /> control configured
                    </div>
                  )}
                </li>
              ))}
            </ul>

            <p className="mt-4 text-xs text-[var(--muted)]">
              <IconWarning size={12} className="mr-1 inline" />
              Each row is computed from the live service state, not editable text.
              Public Trust Center claims live at <Link href="/trust" className="underline">/trust</Link>.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
