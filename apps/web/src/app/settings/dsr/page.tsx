'use client';

// Data Subject Request (DSR) admin queue.
//
// Compliance operators triage GDPR/CCPA requests submitted through the
// public form at /privacy/request. Owners with active MFA can move a
// row to acknowledged | fulfilled | rejected; admins can read the queue
// for posture review but cannot resolve. Status changes are written to
// the immutable audit chain by the existing audit plugin, so this page
// never re-implements that bookkeeping.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  fmtRelative,
  type DsrRecord,
  type DsrStatus,
} from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconShield,
  IconRefresh,
  IconCheck,
  IconWarning,
  IconArrowRight,
} from '@clawmind/ui';

const STATUSES: { value: DsrStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unverified', label: 'Unverified' },
  { value: 'pending', label: 'Pending' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'fulfilled', label: 'Fulfilled' },
  { value: 'rejected', label: 'Rejected' },
];

const KIND_LABEL: Record<string, string> = {
  access: 'Access (Art. 15)',
  erasure: 'Erasure (Art. 17)',
  rectification: 'Rectification (Art. 16)',
  portability: 'Portability (Art. 20)',
  restriction: 'Restriction (Art. 18)',
};

function StatusPill({ s }: { s: DsrStatus }) {
  const tone =
    s === 'fulfilled'
      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
      : s === 'rejected'
        ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30'
        : s === 'pending' || s === 'acknowledged'
          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
          : 'border-[var(--border)] text-[var(--muted)]';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${tone}`}>
      {s}
    </span>
  );
}

function slaDaysLeft(createdAt: number): number {
  // GDPR Art. 12(3): respond within one month; we surface the 30-day clock.
  const elapsed = Math.floor((Date.now() - createdAt) / (24 * 60 * 60 * 1000));
  return 30 - elapsed;
}

export default function DsrAdminPage() {
  const [rows, setRows] = useState<DsrRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<DsrStatus | 'all'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.dsrList(filter === 'all' ? undefined : filter);
      setRows(r);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You do not have permission to view the DSR queue.');
      } else {
        setError(err instanceof Error ? err.message : 'failed to load');
      }
      setRows(null);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateStatus = async (id: string, status: DsrStatus) => {
    setBusyId(id);
    setActionError(null);
    try {
      await api.dsrUpdate(id, { status });
      await load();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'update failed';
      setActionError(msg);
    } finally {
      setBusyId(null);
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (rows ?? []).forEach((r) => {
      c[r.status] = (c[r.status] ?? 0) + 1;
    });
    return c;
  }, [rows]);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <TopNav />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[var(--muted)]">
              <IconShield size={16} />
              <span className="text-xs uppercase tracking-wide">Privacy</span>
            </div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Data subject requests
            </h1>
            <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">
              Intake queue for GDPR Article 15/17 and CCPA §1798.110/.105 requests
              submitted at{' '}
              <Link href="/privacy/request" className="underline">
                /privacy/request
              </Link>
              . Owners with active MFA can resolve.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--fg)]"
          >
            <IconRefresh size={14} /> Refresh
          </button>
        </header>

        <div className="mb-4 flex flex-wrap gap-1.5">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setFilter(s.value as DsrStatus | 'all')}
              className={`rounded-md border px-2.5 py-1 text-xs ${
                filter === s.value
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--fg)]'
                  : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              {s.label}
              {filter === 'all' && counts[s.value] ? (
                <span className="ml-1.5 tabular-nums text-[var(--muted)]">{counts[s.value]}</span>
              ) : null}
            </button>
          ))}
        </div>

        {actionError ? (
          <div className="mb-3 rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
            <IconWarning size={12} className="mr-1 inline" /> {actionError}
          </div>
        ) : null}

        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : rows === null ? (
          <div className="flex items-center justify-center py-12">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No requests"
            body={
              filter === 'all'
                ? 'When a data subject submits a request through /privacy/request it appears here.'
                : `No requests in ${filter} state.`
            }
          />
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => {
              const days = slaDaysLeft(r.createdAt);
              const dueTone =
                days < 0
                  ? 'text-rose-500'
                  : days <= 7
                    ? 'text-amber-500'
                    : 'text-[var(--muted)]';
              const busy = busyId === r.id;
              return (
                <li
                  key={r.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm">{r.subjectEmail}</span>
                        <StatusPill s={r.status} />
                        <span className="text-xs text-[var(--muted)]">
                          {KIND_LABEL[r.kind] ?? r.kind}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-[var(--muted)]">
                        Submitted {fmtRelative(r.createdAt)}
                        {r.verifiedAt ? ` · verified ${fmtRelative(r.verifiedAt)}` : ' · awaiting verification'}
                        {' · '}
                        <span className={dueTone}>
                          {r.status === 'fulfilled' || r.status === 'rejected'
                            ? `resolved ${fmtRelative(r.resolvedAt)}`
                            : days < 0
                              ? `${Math.abs(days)}d overdue`
                              : `${days}d to respond`}
                        </span>
                      </div>
                      {r.details ? (
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--fg)]/90">
                          {r.details}
                        </p>
                      ) : null}
                      {r.note ? (
                        <p className="mt-2 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--muted)]">
                          Note: {r.note}
                        </p>
                      ) : null}
                    </div>
                    {r.status !== 'unverified' && r.status !== 'fulfilled' && r.status !== 'rejected' ? (
                      <div className="flex flex-shrink-0 gap-1.5">
                        {r.status === 'pending' ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void updateStatus(r.id, 'acknowledged')}
                            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--surface)] disabled:opacity-50"
                          >
                            Acknowledge
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void updateStatus(r.id, 'fulfilled')}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-400"
                        >
                          <IconCheck size={12} /> Fulfill
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void updateStatus(r.id, 'rejected')}
                          className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-600 hover:bg-rose-500/20 disabled:opacity-50 dark:text-rose-400"
                        >
                          Reject
                        </button>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-8 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
          <Link href="/admin" className="inline-flex items-center gap-1 hover:text-[var(--fg)]">
            Back to admin console <IconArrowRight size={12} />
          </Link>
        </div>
      </main>
    </div>
  );
}
