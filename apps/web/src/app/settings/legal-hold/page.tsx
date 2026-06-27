'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, type LegalHold, ApiError } from '@/lib/api';
import {
  ErrorState,
  SettingsCardSkeleton,
  Spinner,
  IconArrowRight,
  IconCheck,
  IconRefresh,
  IconShield,
  IconWarning,
} from '@clawmind/ui';

function fmtDate(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

export default function LegalHoldPage() {
  const [hold, setHold] = useState<LegalHold | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reason, setReason] = useState('');
  const [ticket, setTicket] = useState('');
  const [saving, setSaving] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const h = await api.legalHoldGet();
      setHold(h);
      setReason(h.reason ?? '');
      setTicket(h.ticket ?? '');
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You do not have permission to view the legal hold settings.');
      } else {
        setError(err instanceof Error ? err.message : 'failed to load');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const impose = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setSaving(true);
    try {
      const next = await api.legalHoldImpose({
        reason: reason.trim() === '' ? null : reason.trim(),
        ticket: ticket.trim() === '' ? null : ticket.trim(),
      });
      setHold(next);
      setSavedAt(Date.now());
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'save failed';
      setActionError(msg);
    } finally {
      setSaving(false);
    }
  };

  const release = async () => {
    if (
      !window.confirm(
        'Release the legal hold? Scheduled retention sweeps and user-initiated data deletion will resume.',
      )
    )
      return;
    setActionError(null);
    setReleasing(true);
    try {
      const next = await api.legalHoldRelease();
      setHold(next);
      setReason('');
      setTicket('');
      setSavedAt(Date.now());
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'release failed';
      setActionError(msg);
    } finally {
      setReleasing(false);
    }
  };

  return (
    <div className="min-h-screen bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="rounded-md border border-cm-border bg-cm-subtle p-2 text-cm-accent">
              <IconShield size={22} />
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                Legal hold
              </h1>
              <p className="text-sm text-cm-muted">
                Suppress data deletion across the workspace during litigation or
                investigation. Owner-only, MFA required.
              </p>
            </div>
          </div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-sm text-cm-muted hover:text-cm-fg"
          >
            Back to settings <IconArrowRight size={14} />
          </Link>
        </div>

        {loading ? (
          <SettingsCardSkeleton rows={3} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : !hold ? (
          <ErrorState message="Could not load legal hold status." onRetry={() => void load()} />
        ) : (
          <div className="space-y-6">
            <section
              className={`rounded-lg border p-5 ${
                hold.active
                  ? 'border-cm-cite-line bg-cm-cite-bg'
                  : 'border-cm-border bg-cm-paper'
              }`}
            >
              <div className="flex items-start gap-3">
                <span className={hold.active ? 'text-cm-cite' : 'text-cm-success'}>
                  {hold.active ? (
                    <IconWarning size={22} />
                  ) : (
                    <IconCheck size={22} />
                  )}
                </span>
                <div className="flex-1 text-sm">
                  <div className="font-medium">
                    {hold.active ? 'Hold is ACTIVE' : 'No hold in effect'}
                  </div>
                  <div className="mt-1 text-cm-muted">
                    {hold.active ? (
                      <>
                        User-initiated data deletion and scheduled retention
                        sweeps are blocked. Imposed by{' '}
                        <span className="font-mono">{hold.imposedBy ?? 'unknown'}</span>{' '}
                        at {fmtDate(hold.imposedAt)}.
                      </>
                    ) : (
                      <>
                        Retention policies and self-service deletion endpoints
                        operate normally.
                        {hold.releasedAt
                          ? ` Last released ${fmtDate(hold.releasedAt)} by ${hold.releasedBy ?? 'unknown'}.`
                          : ''}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <form
              onSubmit={impose}
              className="space-y-4 rounded-lg border border-cm-border bg-cm-paper p-5"
            >
              <div>
                <h2 className="text-base font-semibold">
                  {hold.active ? 'Update hold metadata' : 'Impose a new hold'}
                </h2>
                <p className="mt-1 text-sm text-cm-muted">
                  Audit-logged. Requires owner role and a recent MFA step-up.
                </p>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="lh-ticket"
                  className="block text-sm font-medium"
                >
                  Ticket / case reference
                </label>
                <input
                  id="lh-ticket"
                  type="text"
                  value={ticket}
                  onChange={(e) => setTicket(e.target.value)}
                  maxLength={200}
                  placeholder="e.g. LEGAL-2026-042"
                  className="w-full rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm placeholder:text-cm-faint focus:outline-none focus:ring-2 focus:ring-cm-accent"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="lh-reason"
                  className="block text-sm font-medium"
                >
                  Reason
                </label>
                <textarea
                  id="lh-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="Short summary stored alongside the hold record."
                  className="w-full rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm placeholder:text-cm-faint focus:outline-none focus:ring-2 focus:ring-cm-accent"
                />
                <div className="text-right text-xs text-cm-muted">
                  {reason.length}/500
                </div>
              </div>

              {actionError ? (
                <div className="rounded-md border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] p-3 text-sm text-[var(--cm-danger)]">
                  {actionError}
                </div>
              ) : null}

              {savedAt ? (
                <div className="flex items-center gap-2 text-sm text-[var(--cm-success)]">
                  <IconCheck size={16} /> Saved at {new Date(savedAt).toLocaleTimeString()}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-md bg-cm-fg px-4 py-2 text-sm font-medium text-cm-bg transition hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? <Spinner /> : <IconShield size={16} />}
                  {hold.active ? 'Update hold' : 'Impose hold'}
                </button>
                {hold.active ? (
                  <button
                    type="button"
                    onClick={() => void release()}
                    disabled={releasing}
                    className="inline-flex items-center gap-2 rounded-md border border-cm-border px-4 py-2 text-sm font-medium transition hover:bg-cm-subtle disabled:opacity-50"
                  >
                    {releasing ? <Spinner /> : <IconRefresh size={16} />}
                    Release hold
                  </button>
                ) : null}
              </div>
            </form>

            <div className="rounded-lg border border-cm-border bg-cm-paper p-5 text-sm text-cm-muted">
              <h3 className="text-sm font-semibold text-cm-fg">
                What a hold blocks
              </h3>
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li>DELETE /v1/me/data (self-service GDPR erase)</li>
                <li>POST /v1/retention/apply (scheduled retention sweep)</li>
              </ul>
              <h3 className="mt-4 text-sm font-semibold text-cm-fg">
                What a hold does not affect
              </h3>
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li>Normal product reads and writes</li>
                <li>Data export endpoints (preservation friendly)</li>
                <li>The audit log itself, which is always retained</li>
              </ul>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
