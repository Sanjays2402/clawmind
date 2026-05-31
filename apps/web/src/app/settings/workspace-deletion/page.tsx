'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, type WorkspaceDeletionEnvelope, ApiError } from '@/lib/api';
import {
  ErrorState,
  Spinner,
  IconArrowRight,
  IconCheck,
  IconRefresh,
  IconShield,
  IconTrash,
  IconWarning,
} from '@clawmind/ui';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function fmtDate(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return 'unset';
  if (ms < HOUR_MS) return `${Math.round(ms / 60000)} min`;
  if (ms < DAY_MS) return `${Math.round((ms / HOUR_MS) * 10) / 10} h`;
  return `${Math.round((ms / DAY_MS) * 10) / 10} days`;
}

function fmtCountdown(scheduledFor: number | null, now: number): string {
  if (!scheduledFor) return '';
  const delta = scheduledFor - now;
  if (delta <= 0) return 'past due';
  const days = Math.floor(delta / DAY_MS);
  const hours = Math.floor((delta % DAY_MS) / HOUR_MS);
  const mins = Math.floor((delta % HOUR_MS) / 60000);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export default function WorkspaceDeletionPage() {
  const [env, setEnv] = useState<WorkspaceDeletionEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reason, setReason] = useState('');
  const [ticket, setTicket] = useState('');
  const [graceDays, setGraceDays] = useState<string>('7');
  const [busy, setBusy] = useState<'schedule' | 'cancel' | 'complete' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const e = await api.workspaceDeletionGet();
      setEnv(e);
      if (e.deletion.state === 'pending') {
        setReason(e.deletion.reason ?? '');
        setTicket(e.deletion.ticket ?? '');
        if (e.deletion.graceMs) setGraceDays(String(e.deletion.graceMs / DAY_MS));
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You do not have permission to view workspace deletion settings.');
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

  const limits = env?.limits;
  const graceMs = useMemo(() => {
    const n = Number(graceDays);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.floor(n * DAY_MS);
  }, [graceDays]);

  const graceInvalid =
    graceMs === null ||
    (limits !== undefined && (graceMs < limits.minGraceMs || graceMs > limits.maxGraceMs));

  const schedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    if (graceInvalid || graceMs === null) {
      setActionError('Grace window must be between 1 hour and 90 days.');
      return;
    }
    if (
      !window.confirm(
        `Schedule workspace deletion for ${fmtDuration(graceMs)} from now? Mutating endpoints will return 423 until you cancel or the wipe runs.`,
      )
    )
      return;
    setBusy('schedule');
    try {
      const next = await api.workspaceDeletionSchedule({
        reason: reason.trim() === '' ? null : reason.trim(),
        ticket: ticket.trim() === '' ? null : ticket.trim(),
        graceMs,
      });
      setEnv(next);
      setSavedAt(Date.now());
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'schedule failed',
      );
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    if (!window.confirm('Cancel the scheduled deletion? Writes will resume immediately.')) return;
    setActionError(null);
    setBusy('cancel');
    try {
      const next = await api.workspaceDeletionCancel();
      setEnv(next);
      setSavedAt(Date.now());
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'cancel failed',
      );
    } finally {
      setBusy(null);
    }
  };

  const complete = async () => {
    if (
      !window.confirm(
        'Mark this workspace as deleted? Only do this after the operator wipe job has run. This is irreversible.',
      )
    )
      return;
    setActionError(null);
    setBusy('complete');
    try {
      const next = await api.workspaceDeletionComplete();
      setEnv(next);
      setSavedAt(Date.now());
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'mark complete failed',
      );
    } finally {
      setBusy(null);
    }
  };

  const d = env?.deletion;
  const pending = d?.state === 'pending';
  const completed = d?.state === 'completed';

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconTrash size={22} />
            <div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                Workspace deletion
              </h1>
              <p className="text-sm text-[var(--muted-fg)]">
                Schedule a tenant-wide wipe with a cancelable grace window. Owner only, MFA required.
              </p>
            </div>
          </div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-sm text-[var(--muted-fg)] hover:text-[var(--fg)]"
          >
            Back to settings <IconArrowRight size={14} />
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--muted-fg)]">
            <Spinner /> Loading deletion status...
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : !env || !d ? (
          <ErrorState message="Could not load deletion status." onRetry={() => void load()} />
        ) : (
          <div className="space-y-6">
            <section
              className={`rounded-lg border p-5 ${
                pending
                  ? 'border-red-500/50 bg-red-500/10'
                  : completed
                    ? 'border-zinc-500/50 bg-zinc-500/10'
                    : 'border-[var(--border)] bg-[var(--card)]'
              }`}
            >
              <div className="flex items-start gap-3">
                {pending ? (
                  <IconWarning size={22} />
                ) : completed ? (
                  <IconTrash size={22} />
                ) : (
                  <IconCheck size={22} />
                )}
                <div className="flex-1 text-sm">
                  <div className="font-medium">
                    {pending
                      ? `Workspace deletion PENDING (${fmtCountdown(d.scheduledFor, now)})`
                      : completed
                        ? 'Workspace was deleted'
                        : 'No deletion scheduled'}
                  </div>
                  <div className="mt-1 text-[var(--muted-fg)]">
                    {pending ? (
                      <>
                        Mutating endpoints return HTTP 423. Reads, exports, MFA step-up,
                        and sign-out remain available so you can pull a final bundle
                        before {fmtDate(d.scheduledFor)}. Scheduled by{' '}
                        <span className="font-mono">{d.scheduledBy ?? 'unknown'}</span>{' '}
                        at {fmtDate(d.scheduledAt)}.
                      </>
                    ) : completed ? (
                      <>
                        Marked completed at {fmtDate(d.completedAt)} by{' '}
                        <span className="font-mono">{d.completedBy ?? 'unknown'}</span>.
                      </>
                    ) : d.state === 'cancelled' ? (
                      <>
                        Last schedule cancelled at {fmtDate(d.cancelledAt)} by{' '}
                        <span className="font-mono">{d.cancelledBy ?? 'unknown'}</span>.
                      </>
                    ) : (
                      <>
                        Schedule a deletion to start a cancelable countdown.
                      </>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {!completed ? (
              <form
                onSubmit={schedule}
                className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--card)] p-5"
              >
                <div>
                  <h2 className="text-base font-semibold">
                    {pending ? 'Pending deletion (cancel below to reschedule)' : 'Schedule deletion'}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--muted-fg)]">
                    Audit-logged. Requires owner role and a recent MFA step-up. Grace
                    window must be between {fmtDuration(limits?.minGraceMs ?? null)} and{' '}
                    {fmtDuration(limits?.maxGraceMs ?? null)}.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label htmlFor="wd-ticket" className="block text-sm font-medium">
                      Ticket / change reference
                    </label>
                    <input
                      id="wd-ticket"
                      type="text"
                      value={ticket}
                      onChange={(e) => setTicket(e.target.value)}
                      maxLength={200}
                      disabled={pending}
                      placeholder="e.g. CS-2026-014"
                      className="w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none disabled:opacity-60"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="wd-grace" className="block text-sm font-medium">
                      Grace window (days)
                    </label>
                    <input
                      id="wd-grace"
                      type="number"
                      min={limits ? limits.minGraceMs / DAY_MS : 0.05}
                      max={limits ? limits.maxGraceMs / DAY_MS : 90}
                      step={0.05}
                      value={graceDays}
                      onChange={(e) => setGraceDays(e.target.value)}
                      disabled={pending}
                      className="w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none disabled:opacity-60"
                    />
                    <div className="text-xs text-[var(--muted-fg)]">
                      Resolves to {fmtDuration(graceMs)}
                      {graceInvalid ? ' (out of range)' : ''}.
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <label htmlFor="wd-reason" className="block text-sm font-medium">
                    Reason
                  </label>
                  <textarea
                    id="wd-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={500}
                    rows={3}
                    disabled={pending}
                    placeholder="Short summary stored on the deletion record."
                    className="w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none disabled:opacity-60"
                  />
                  <div className="text-right text-xs text-[var(--muted-fg)]">
                    {reason.length}/500
                  </div>
                </div>

                {actionError ? (
                  <div className="rounded border border-red-500/50 bg-red-500/10 p-3 text-sm">
                    {actionError}
                  </div>
                ) : null}

                {savedAt ? (
                  <div className="flex items-center gap-2 text-sm text-emerald-500">
                    <IconCheck size={16} /> Updated at {new Date(savedAt).toLocaleTimeString()}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  {!pending ? (
                    <button
                      type="submit"
                      disabled={busy !== null || graceInvalid}
                      className="inline-flex items-center gap-2 rounded bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {busy === 'schedule' ? <Spinner /> : <IconTrash size={16} />}
                      Schedule deletion
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => void cancel()}
                        disabled={busy !== null}
                        className="inline-flex items-center gap-2 rounded bg-[var(--fg)] px-4 py-2 text-sm font-medium text-[var(--bg)] disabled:opacity-50"
                      >
                        {busy === 'cancel' ? <Spinner /> : <IconRefresh size={16} />}
                        Cancel deletion
                      </button>
                      {env.pastDue ? (
                        <button
                          type="button"
                          onClick={() => void complete()}
                          disabled={busy !== null}
                          className="inline-flex items-center gap-2 rounded border border-red-500/60 px-4 py-2 text-sm font-medium text-red-500 disabled:opacity-50"
                        >
                          {busy === 'complete' ? <Spinner /> : <IconTrash size={16} />}
                          Mark wipe complete
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </form>
            ) : null}

            <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5 text-sm text-[var(--muted-fg)]">
              <h3 className="text-sm font-semibold text-[var(--fg)]">
                What scheduling does
              </h3>
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li>Starts a cancelable countdown the customer can quote in an exit plan.</li>
                <li>Blocks every POST, PUT, PATCH, DELETE outside the allowlist with HTTP 423.</li>
                <li>Keeps reads, GDPR export, auth, and the deletion endpoint itself open.</li>
                <li>Writes audit entries on schedule, cancel, and mark-complete.</li>
              </ul>
              <h3 className="mt-4 text-sm font-semibold text-[var(--fg)]">
                What it does not do
              </h3>
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li>Run the wipe itself. After scheduledFor passes, an operator script removes the data and posts to /v1/workspace/deletion/complete.</li>
                <li>Bypass legal hold. An active hold still blocks the underlying destructive paths.</li>
              </ul>
              <div className="mt-4">
                <IconShield size={14} className="mr-1 inline align-text-bottom" />
                Pair with /settings/security to confirm MFA enrolment before scheduling.
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
