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

// Posture statuses route through the brand feedback inks so the scorecard
// reads on the warm paper-cream surface: pass = --cm-success, warn = the
// citation gold (the app's caution ink), fail = --cm-danger.
const STATUS_INK: Record<'pass' | 'warn' | 'fail', string> = {
  pass: 'var(--cm-success)',
  warn: 'var(--cm-cite)',
  fail: 'var(--cm-danger)',
};
const STATUS_TINT: Record<'pass' | 'warn' | 'fail', string> = {
  pass: 'rgba(47, 122, 85, 0.10)',
  warn: 'var(--cm-cite-bg)',
  fail: 'rgba(180, 66, 60, 0.10)',
};

function StatusDot({ status }: { status: 'pass' | 'warn' | 'fail' }) {
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 rounded-full"
      style={{ background: STATUS_INK[status] }}
    />
  );
}

function StatusBadge({ status }: { status: 'pass' | 'warn' | 'fail' }) {
  return (
    <span
      className="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{
        color: STATUS_INK[status],
        borderColor: STATUS_INK[status],
        background: STATUS_TINT[status],
      }}
    >
      {status}
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

  const scoreInk =
    data == null
      ? 'var(--cm-muted)'
      : data.score >= 90
        ? 'var(--cm-success)'
        : data.score >= 70
          ? 'var(--cm-cite)'
          : 'var(--cm-danger)';

  return (
    <div className="min-h-screen bg-cm-bg">
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
              className="inline-flex items-center gap-1.5 rounded-md border border-cm-border bg-cm-paper px-2.5 py-1.5 text-xs font-medium text-cm-fg hover:bg-cm-subtle disabled:opacity-50"
              disabled={loading}
            >
              <IconRefresh size={14} /> Refresh
            </button>
            <button
              onClick={download}
              className="inline-flex items-center gap-1.5 rounded-md border border-cm-border bg-cm-paper px-2.5 py-1.5 text-xs font-medium text-cm-fg hover:bg-cm-subtle disabled:opacity-50"
              disabled={!data}
            >
              <IconDownload size={14} /> Export JSON
            </button>
          </div>
        </div>

        <p className="mb-5 text-sm text-cm-muted">
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
              <div className="rounded-lg border border-cm-border bg-cm-paper p-4">
                <div className="text-[11px] uppercase tracking-wide text-cm-muted">Score</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: scoreInk }}>{data.score}</div>
                <div className="mt-1 text-xs text-cm-muted">{data.ready ? 'Procurement-ready' : 'Action required'}</div>
              </div>
              <div className="rounded-lg border border-cm-border bg-cm-paper p-4">
                <div className="text-[11px] uppercase tracking-wide text-cm-muted">Pass</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: 'var(--cm-success)' }}>{data.counts.pass}</div>
              </div>
              <div className="rounded-lg border border-cm-border bg-cm-paper p-4">
                <div className="text-[11px] uppercase tracking-wide text-cm-muted">Warn</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: 'var(--cm-cite)' }}>{data.counts.warn}</div>
              </div>
              <div className="rounded-lg border border-cm-border bg-cm-paper p-4">
                <div className="text-[11px] uppercase tracking-wide text-cm-muted">Fail</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: 'var(--cm-danger)' }}>{data.counts.fail}</div>
              </div>
            </section>

            <div className="mb-3 text-xs text-cm-muted">
              Generated {fmtRelative(data.generatedAt)}
            </div>

            <ul className="divide-y divide-cm-border overflow-hidden rounded-lg border border-cm-border bg-cm-paper">
              {data.controls.map((c) => (
                <li key={c.id} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusDot status={c.status} />
                    <span className="text-sm font-semibold">{c.title}</span>
                    <StatusBadge status={c.status} />
                    <span className="text-[10px] uppercase tracking-wide text-cm-muted">{c.family}</span>
                  </div>
                  <div className="mt-1.5 text-sm text-cm-fg">{c.detail}</div>
                  {c.remediation ? (
                    <div className="mt-1.5 flex items-start gap-1.5 text-xs text-cm-muted">
                      <IconArrowRight size={12} className="mt-0.5 shrink-0" />
                      <span className="break-all">{c.remediation}</span>
                    </div>
                  ) : (
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs" style={{ color: 'var(--cm-success)' }}>
                      <IconCheck size={12} /> control configured
                    </div>
                  )}
                </li>
              ))}
            </ul>

            <p className="mt-4 text-xs text-cm-muted">
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
