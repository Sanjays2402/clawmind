'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  type WarrantCanaryAdmin,
  type WarrantCanaryStatus,
} from '@/lib/api';
import {
  ErrorState,
  Spinner,
  IconCheck,
  IconRefresh,
  IconShield,
  IconWarning,
} from '@clawmind/ui';

// Warrant canary settings (owner only, MFA at the API).
// The public projection lives at /v1/warrant-canary; this page is the
// admin console that produces it. Every mutation round-trips through
// the API and lands in the audit chain.

function fmt(ts: number | null | undefined): string {
  if (!ts) return 'never';
  try {
    return new Date(ts).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  } catch {
    return 'unknown';
  }
}

function statusLabel(s: WarrantCanaryStatus): string {
  switch (s) {
    case 'active':
      return 'Active';
    case 'stale':
      return 'Stale (overdue)';
    case 'withdrawn':
      return 'Withdrawn';
    default:
      return 'Not configured';
  }
}

function statusColor(s: WarrantCanaryStatus): string {
  switch (s) {
    case 'active':
      return 'text-emerald-600';
    case 'stale':
      return 'text-amber-600';
    case 'withdrawn':
      return 'text-red-600';
    default:
      return 'text-[var(--muted)]';
  }
}

export default function WarrantCanaryPage() {
  const [doc, setDoc] = useState<WarrantCanaryAdmin | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [cadence, setCadence] = useState(30);
  const [preamble, setPreamble] = useState('');
  const [statement, setStatement] = useState('');
  const [withdrawReason, setWithdrawReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.warrantCanaryAdmin();
      setDoc(d);
      setEnabled(d.enabled);
      setCadence(d.defaultCadenceDays);
      setPreamble(d.preamble);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You need admin or owner access to view the warrant canary.');
      } else if (err instanceof ApiError && err.status === 401) {
        setError('Sign in to view the warrant canary.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load warrant canary.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSettings = useCallback(async () => {
    setActionError(null);
    setSubmitting(true);
    try {
      const next = await api.warrantCanarySettings({
        enabled,
        defaultCadenceDays: cadence,
        preamble,
      });
      setDoc(next);
      setSavedAt(Date.now());
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSubmitting(false);
    }
  }, [enabled, cadence, preamble]);

  const sign = useCallback(async () => {
    setActionError(null);
    if (!statement.trim()) {
      setActionError('Attestation statement is required.');
      return;
    }
    setSubmitting(true);
    try {
      await api.warrantCanaryAttest({ statement: statement.trim() });
      setStatement('');
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Sign failed.');
    } finally {
      setSubmitting(false);
    }
  }, [statement, load]);

  const withdraw = useCallback(async () => {
    setActionError(null);
    if (!withdrawReason.trim()) {
      setActionError('A withdrawal reason is required for the audit record.');
      return;
    }
    if (!confirm('Withdraw the current attestation? This is recorded immutably.')) return;
    setSubmitting(true);
    try {
      await api.warrantCanaryWithdraw({ reason: withdrawReason.trim() });
      setWithdrawReason('');
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Withdraw failed.');
    } finally {
      setSubmitting(false);
    }
  }, [withdrawReason, load]);

  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <Link href="/settings" className="text-sm text-[var(--muted)] hover:underline">
            ← Settings
          </Link>
        </div>
        <header className="mb-6 flex items-start gap-3">
          <IconShield size={28} />
          <div>
            <h1 className="text-xl font-semibold">Warrant canary</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Recurring public attestation that no undisclosed legal process has been received. The public
              projection at <code className="rounded bg-[var(--bg)] px-1">/v1/warrant-canary</code> is the URL
              procurement reviewers pin in their vendor file. Owner only, MFA gated.
            </p>
          </div>
        </header>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <Spinner /> Loading...
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : doc ? (
          <div className="space-y-8">
            <section className="rounded-xl border border-[var(--border)] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-[var(--muted)]">Current status</div>
                  <div className={`mt-1 text-lg font-semibold ${statusColor(doc.status)}`}>
                    {statusLabel(doc.status)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={load}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs hover:bg-[var(--bg)]"
                >
                  <IconRefresh size={14} /> Refresh
                </button>
              </div>
              {doc.history.length > 0 && (
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                  <dt className="text-[var(--muted)]">Last signed</dt>
                  <dd>{fmt(doc.history[doc.history.length - 1]!.attestedAt)}</dd>
                  <dt className="text-[var(--muted)]">Expires</dt>
                  <dd>{fmt(doc.history[doc.history.length - 1]!.expiresAt)}</dd>
                  <dt className="text-[var(--muted)]">Fingerprint</dt>
                  <dd className="font-mono text-xs break-all">
                    {doc.history[doc.history.length - 1]!.fingerprint}
                  </dd>
                </dl>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Settings</h2>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-4 w-4"
                />
                Enable warrant canary
              </label>
              <label className="block text-sm">
                <span className="block text-xs text-[var(--muted)]">
                  Default cadence (days, 1 to 365)
                </span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={cadence}
                  onChange={(e) => setCadence(Number(e.target.value))}
                  className="mt-1 w-32 rounded-md border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="block text-xs text-[var(--muted)]">
                  Public preamble (shown above the latest attestation)
                </span>
                <textarea
                  value={preamble}
                  onChange={(e) => setPreamble(e.target.value)}
                  rows={3}
                  maxLength={4000}
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
                />
              </label>
              <button
                type="button"
                onClick={saveSettings}
                disabled={submitting}
                className="inline-flex items-center gap-1 rounded-md bg-[var(--fg)] px-3 py-1.5 text-sm text-[var(--bg)] disabled:opacity-50"
              >
                <IconCheck size={14} /> Save settings
              </button>
              {savedAt && (
                <div className="text-xs text-[var(--muted)]">Saved {fmt(savedAt)}.</div>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Sign new attestation</h2>
              <textarea
                placeholder="No undisclosed legal process (NSL, gag order, sealed subpoena) has been received since the previous attestation."
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
                rows={4}
                maxLength={8000}
                className="w-full rounded-md border border-[var(--border)] bg-transparent px-2 py-2 text-sm"
              />
              <button
                type="button"
                onClick={sign}
                disabled={submitting || !enabled}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                <IconCheck size={14} /> Sign attestation
              </button>
              {!enabled && (
                <p className="text-xs text-[var(--muted)]">
                  Enable the canary above before signing.
                </p>
              )}
            </section>

            {doc.history.length > 0 && doc.history[doc.history.length - 1]!.withdrawnAt == null && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold">Withdraw current attestation</h2>
                <p className="text-xs text-[var(--muted)]">
                  Use this when the canary should no longer be trusted. The reason is captured in the audit
                  chain. The history record is preserved.
                </p>
                <input
                  placeholder="Reason (recorded in audit log)"
                  value={withdrawReason}
                  onChange={(e) => setWithdrawReason(e.target.value)}
                  maxLength={1000}
                  className="w-full rounded-md border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={withdraw}
                  disabled={submitting}
                  className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  <IconWarning size={14} /> Withdraw
                </button>
              </section>
            )}

            {actionError && <ErrorState message={actionError} />}

            <section>
              <h2 className="mb-2 text-sm font-semibold">History</h2>
              {doc.history.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No attestations yet.</p>
              ) : (
                <ul className="space-y-3">
                  {[...doc.history].reverse().map((r) => (
                    <li
                      key={r.id}
                      className="rounded-lg border border-[var(--border)] p-3 text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs text-[var(--muted)]">{r.id}</span>
                        <span className="text-xs text-[var(--muted)]">{fmt(r.attestedAt)}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap">{r.statement}</p>
                      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
                        <span>Cadence: {r.cadenceDays} days</span>
                        <span>Expires: {fmt(r.expiresAt)}</span>
                        {r.withdrawnAt && (
                          <>
                            <span className="text-red-600">Withdrawn: {fmt(r.withdrawnAt)}</span>
                            <span className="text-red-600">Reason: {r.withdrawnReason}</span>
                          </>
                        )}
                      </div>
                      <div className="mt-1 font-mono text-[10px] break-all text-[var(--muted)]">
                        sha256:{r.fingerprint}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}
