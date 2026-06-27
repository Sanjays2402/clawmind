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
  SettingsCardSkeleton,
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

// Shared input chrome on the paper surface: cm-bg fill, faint placeholder,
// accent focus ring.
const INPUT_CLS =
  'rounded-md border border-cm-border bg-cm-bg px-2 py-1 text-sm text-cm-fg outline-none placeholder:text-cm-faint focus:ring-2 focus:ring-cm-accent';

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
      return 'text-cm-success';
    case 'stale':
      return 'text-cm-cite';
    case 'withdrawn':
      return 'text-cm-danger';
    default:
      return 'text-cm-muted';
  }
}

// The status panel surface tracks the same semantics as the label: a healthy,
// current canary gets a calm success wash; an overdue statement reads as a
// gold caution (a pause that wants attention, not a hard failure); a withdrawn
// canary is a danger surface; an unconfigured one stays neutral paper.
function statusSurface(s: WarrantCanaryStatus): string {
  switch (s) {
    case 'active':
      return 'border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)]';
    case 'stale':
      return 'border-cm-cite-line bg-cm-cite-bg';
    case 'withdrawn':
      return 'border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)]';
    default:
      return 'border-cm-border bg-cm-paper';
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
    <div className="min-h-screen bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <Link href="/settings" className="text-sm text-cm-muted hover:text-cm-fg hover:underline">
            &larr; Settings
          </Link>
        </div>
        <header className="mb-6 flex items-start gap-3">
          <span className="rounded-md border border-cm-border bg-cm-subtle p-2 text-cm-accent">
            <IconShield size={24} />
          </span>
          <div>
            <h1 className="text-xl font-semibold">Warrant canary</h1>
            <p className="mt-1 text-sm text-cm-muted">
              Recurring public attestation that no undisclosed legal process has been received. The public
              projection at <code className="cm-mono rounded bg-cm-subtle px-1 text-cm-fg">/v1/warrant-canary</code> is
              the URL procurement reviewers pin in their vendor file. Owner only, MFA gated.
            </p>
          </div>
        </header>

        {loading ? (
          <SettingsCardSkeleton rows={3} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : doc ? (
          <div className="space-y-8">
            <section className={`rounded-xl border p-4 ${statusSurface(doc.status)}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-cm-muted">Current status</div>
                  <div className={`mt-1 text-lg font-semibold ${statusColor(doc.status)}`}>
                    {statusLabel(doc.status)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={load}
                  className="inline-flex items-center gap-1 rounded-md border border-cm-border bg-cm-paper px-2.5 py-1.5 text-xs text-cm-muted hover:bg-cm-subtle hover:text-cm-fg"
                >
                  <IconRefresh size={14} /> Refresh
                </button>
              </div>
              {doc.history.length > 0 && (
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                  <dt className="text-cm-muted">Last signed</dt>
                  <dd>{fmt(doc.history[doc.history.length - 1]!.attestedAt)}</dd>
                  <dt className="text-cm-muted">Expires</dt>
                  <dd>{fmt(doc.history[doc.history.length - 1]!.expiresAt)}</dd>
                  <dt className="text-cm-muted">Fingerprint</dt>
                  <dd className="cm-mono text-xs break-all">
                    {doc.history[doc.history.length - 1]!.fingerprint}
                  </dd>
                </dl>
              )}
            </section>

            <section className="space-y-3 rounded-xl border border-cm-border bg-cm-paper p-5">
              <h2 className="text-sm font-semibold">Settings</h2>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-4 w-4 accent-[var(--cm-accent)]"
                />
                Enable warrant canary
              </label>
              <label className="block text-sm">
                <span className="block text-xs text-cm-muted">
                  Default cadence (days, 1 to 365)
                </span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={cadence}
                  onChange={(e) => setCadence(Number(e.target.value))}
                  className={`mt-1 w-32 ${INPUT_CLS}`}
                />
              </label>
              <label className="block text-sm">
                <span className="block text-xs text-cm-muted">
                  Public preamble (shown above the latest attestation)
                </span>
                <textarea
                  value={preamble}
                  onChange={(e) => setPreamble(e.target.value)}
                  rows={3}
                  maxLength={4000}
                  className={`mt-1 w-full ${INPUT_CLS}`}
                />
              </label>
              <button
                type="button"
                onClick={saveSettings}
                disabled={submitting}
                className="inline-flex items-center gap-1 rounded-md bg-cm-fg px-3 py-1.5 text-sm font-medium text-cm-bg transition hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? <Spinner /> : <IconCheck size={14} />} Save settings
              </button>
              {savedAt && (
                <div className="text-xs text-cm-success">Saved {fmt(savedAt)}.</div>
              )}
            </section>

            <section className="space-y-3 rounded-xl border border-cm-border bg-cm-paper p-5">
              <h2 className="text-sm font-semibold">Sign new attestation</h2>
              <textarea
                placeholder="No undisclosed legal process (NSL, gag order, sealed subpoena) has been received since the previous attestation."
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
                rows={4}
                maxLength={8000}
                className={`w-full ${INPUT_CLS} py-2`}
              />
              <button
                type="button"
                onClick={sign}
                disabled={submitting || !enabled}
                className="inline-flex items-center gap-1 rounded-md bg-cm-fg px-3 py-1.5 text-sm font-medium text-cm-bg transition hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? <Spinner /> : <IconCheck size={14} />} Sign attestation
              </button>
              {!enabled && (
                <p className="text-xs text-cm-muted">
                  Enable the canary above before signing.
                </p>
              )}
            </section>

            {doc.history.length > 0 && doc.history[doc.history.length - 1]!.withdrawnAt == null && (
              <section className="space-y-3 rounded-xl border border-cm-border bg-cm-paper p-5">
                <h2 className="text-sm font-semibold">Withdraw current attestation</h2>
                <p className="text-xs text-cm-muted">
                  Use this when the canary should no longer be trusted. The reason is captured in the audit
                  chain. The history record is preserved.
                </p>
                <input
                  placeholder="Reason (recorded in audit log)"
                  value={withdrawReason}
                  onChange={(e) => setWithdrawReason(e.target.value)}
                  maxLength={1000}
                  className={`w-full ${INPUT_CLS} py-1.5`}
                />
                <button
                  type="button"
                  onClick={withdraw}
                  disabled={submitting}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] px-3 py-1.5 text-sm font-medium text-cm-danger transition hover:bg-[rgba(180,66,60,0.18)] disabled:opacity-50"
                >
                  {submitting ? <Spinner /> : <IconWarning size={14} />} Withdraw
                </button>
              </section>
            )}

            {actionError && (
              <div className="flex items-start gap-2 rounded-lg border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] p-3 text-sm text-cm-danger">
                <IconWarning size={16} />
                <span>{actionError}</span>
              </div>
            )}

            <section>
              <h2 className="mb-2 text-sm font-semibold">History</h2>
              {doc.history.length === 0 ? (
                <p className="text-sm text-cm-muted">No attestations yet.</p>
              ) : (
                <ul className="space-y-3">
                  {[...doc.history].reverse().map((r) => (
                    <li
                      key={r.id}
                      className="rounded-lg border border-cm-border bg-cm-paper p-3 text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="cm-mono text-xs text-cm-muted">{r.id}</span>
                        <span className="text-xs text-cm-muted">{fmt(r.attestedAt)}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap">{r.statement}</p>
                      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-cm-muted">
                        <span>Cadence: {r.cadenceDays} days</span>
                        <span>Expires: {fmt(r.expiresAt)}</span>
                        {r.withdrawnAt && (
                          <>
                            <span className="text-cm-danger">Withdrawn: {fmt(r.withdrawnAt)}</span>
                            <span className="text-cm-danger">Reason: {r.withdrawnReason}</span>
                          </>
                        )}
                      </div>
                      <div className="mt-1 cm-mono text-[10px] break-all text-cm-muted">
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
