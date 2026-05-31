'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  fmtRelative,
  type RoleElevationRequest,
  type RoleElevationCreateInput,
} from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconShield,
  IconClockCountdown,
  IconCheck,
  IconTrash,
  IconWarning,
} from '@clawmind/ui';

const DURATION_OPTIONS = [15, 30, 60, 120, 240];

function statusTone(s: RoleElevationRequest['status']): string {
  switch (s) {
    case 'approved':
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
    case 'pending':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';
    case 'denied':
    case 'revoked':
      return 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20';
    case 'expired':
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function isActive(r: RoleElevationRequest, now: number): boolean {
  return r.status === 'approved' && !!r.expiresAt && r.expiresAt > now && !r.revokedAt;
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return 'expired';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m left`;
  if (m > 0) return `${m}m ${s}s left`;
  return `${s}s left`;
}

export default function RoleElevationPage() {
  const [records, setRecords] = useState<RoleElevationRequest[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const [toRole, setToRole] = useState<'admin' | 'owner'>('owner');
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState(30);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.roleElevationList();
      setRecords(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const submit = async () => {
    setActionError(null);
    setActionMessage(null);
    const trimmed = reason.trim();
    if (!trimmed) {
      setActionError('Reason is required.');
      return;
    }
    setSubmitting(true);
    try {
      const input: RoleElevationCreateInput = {
        toRole,
        reason: trimmed,
        durationMinutes: duration,
      };
      await api.roleElevationCreate(input);
      setActionMessage('Elevation request filed. An owner must approve before it takes effect.');
      setReason('');
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setSubmitting(false);
    }
  };

  const approve = async (r: RoleElevationRequest) => {
    setBusyId(r.id);
    setActionError(null);
    setActionMessage(null);
    try {
      await api.roleElevationApprove(r.id);
      setActionMessage('Approved. The elevated role is now active for the requested window.');
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'approve failed');
    } finally {
      setBusyId(null);
    }
  };

  const deny = async (r: RoleElevationRequest) => {
    const note = prompt('Reason for denial (optional)') ?? '';
    setBusyId(r.id);
    setActionError(null);
    setActionMessage(null);
    try {
      await api.roleElevationDeny(r.id, note);
      setActionMessage('Request denied.');
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'deny failed');
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async (r: RoleElevationRequest) => {
    if (!confirm('Revoke this active elevation right now?')) return;
    setBusyId(r.id);
    setActionError(null);
    setActionMessage(null);
    try {
      await api.roleElevationRevoke(r.id);
      setActionMessage('Elevation revoked.');
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'revoke failed');
    } finally {
      setBusyId(null);
    }
  };

  const pending = useMemo(() => records?.filter((r) => r.status === 'pending') ?? [], [records]);
  const active = useMemo(() => records?.filter((r) => isActive(r, now)) ?? [], [records, now]);
  const history = useMemo(
    () => records?.filter((r) => r.status !== 'pending' && !isActive(r, now)) ?? [],
    [records, now],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-start gap-3">
          <div className="rounded-md border border-border bg-muted/40 p-2">
            <IconShield size={20} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Role elevation</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Time-bound break-glass access. File a request, an owner approves with MFA,
              the elevated role applies for the window you asked for, then drops back
              automatically. Every step is recorded in the audit chain.
            </p>
          </div>
        </div>

        {actionError && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300"
          >
            <span className="mt-0.5 shrink-0"><IconWarning size={16} /></span>
            <span>{actionError}</span>
          </div>
        )}
        {actionMessage && (
          <div
            role="status"
            className="mb-4 flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300"
          >
            <span className="mt-0.5 shrink-0"><IconCheck size={16} /></span>
            <span>{actionMessage}</span>
          </div>
        )}

        <section className="mb-8 rounded-lg border border-border bg-card p-4 sm:p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            File a new request
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Elevate to</span>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={toRole}
                onChange={(e) => setToRole(e.target.value as 'admin' | 'owner')}
              >
                <option value="admin">admin</option>
                <option value="owner">owner</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Duration</span>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              >
                {DURATION_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block text-muted-foreground">
                Reason (becomes part of the audit record)
              </span>
              <textarea
                className="min-h-[80px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="Incident #1234, restoring a deleted collection at the customer's request."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                {reason.length} / 1000
              </span>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={submitting || !reason.trim()}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? <Spinner size={14} /> : <IconClockCountdown size={14} />}
              Request elevation
            </button>
            <p className="text-xs text-muted-foreground">
              An owner other than you must approve. Approval requires MFA step-up.
            </p>
          </div>
        </section>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner size={14} /> Loading requests...
          </div>
        ) : error ? (
          <ErrorState title="Could not load requests" message={error} onRetry={load} />
        ) : (
          <>
            <Section title="Active grants" empty="No grants are currently active.">
              {active.map((r) => (
                <Row
                  key={r.id}
                  r={r}
                  now={now}
                  busyId={busyId}
                  onRevoke={() => revoke(r)}
                />
              ))}
            </Section>

            <Section title="Pending approval" empty="No requests waiting.">
              {pending.map((r) => (
                <Row
                  key={r.id}
                  r={r}
                  now={now}
                  busyId={busyId}
                  onApprove={() => approve(r)}
                  onDeny={() => deny(r)}
                />
              ))}
            </Section>

            <Section title="History" empty="No previous elevation activity.">
              {history.map((r) => (
                <Row key={r.id} r={r} now={now} busyId={busyId} />
              ))}
            </Section>
          </>
        )}

        <div className="mt-10 text-xs text-muted-foreground">
          <Link href="/audit" className="underline decoration-dotted underline-offset-2">
            View the audit chain
          </Link>{' '}
          to see every elevation event with hash anchors.
        </div>
      </main>
    </div>
  );
}

function Section(props: { title: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(props.children) ? props.children : [props.children];
  const hasContent = items.filter(Boolean).length > 0;
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {props.title}
      </h2>
      {hasContent ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <ul className="divide-y divide-border">{props.children}</ul>
        </div>
      ) : (
        <EmptyState title="Nothing here" hint={props.empty} />
      )}
    </section>
  );
}

function Row(props: {
  r: RoleElevationRequest;
  now: number;
  busyId: string | null;
  onApprove?: () => void;
  onDeny?: () => void;
  onRevoke?: () => void;
}) {
  const { r, now, busyId } = props;
  const active = isActive(r, now);
  const remaining = active && r.expiresAt ? r.expiresAt - now : 0;
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${statusTone(
              r.status,
            )}`}
          >
            {r.status}
          </span>
          <span className="text-sm font-medium">
            {r.fromRole} <span className="text-muted-foreground">to</span> {r.toRole}
          </span>
          <span className="text-xs text-muted-foreground">
            for {r.durationMinutes} min
          </span>
          {active && (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <IconClockCountdown size={12} />
              {fmtCountdown(remaining)}
            </span>
          )}
        </div>
        <p className="mt-2 break-words text-sm text-foreground/90">{r.reason}</p>
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <div>
            <dt className="inline">Requested by </dt>
            <dd className="inline font-mono">{r.userId}</dd>
            <dd className="inline"> {fmtRelative(r.requestedAt)}</dd>
          </div>
          {r.approvedBy && (
            <div>
              <dt className="inline">{r.status === 'denied' ? 'Denied by ' : 'Approved by '}</dt>
              <dd className="inline font-mono">{r.approvedBy}</dd>
            </div>
          )}
          {r.revokedBy && (
            <div>
              <dt className="inline">Revoked by </dt>
              <dd className="inline font-mono">{r.revokedBy}</dd>
            </div>
          )}
          {r.expiresAt && (
            <div>
              <dt className="inline">Expires </dt>
              <dd className="inline">{new Date(r.expiresAt).toLocaleString()}</dd>
            </div>
          )}
        </dl>
        {r.decisionReason && (
          <p className="mt-2 text-xs text-muted-foreground">Note: {r.decisionReason}</p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {props.onApprove && (
          <button
            type="button"
            onClick={props.onApprove}
            disabled={busyId === r.id}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-300"
          >
            <IconCheck size={12} /> Approve
          </button>
        )}
        {props.onDeny && (
          <button
            type="button"
            onClick={props.onDeny}
            disabled={busyId === r.id}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            Deny
          </button>
        )}
        {props.onRevoke && (
          <button
            type="button"
            onClick={props.onRevoke}
            disabled={busyId === r.id}
            className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-500/20 disabled:opacity-50 dark:text-rose-300"
          >
            <IconTrash size={12} /> Revoke
          </button>
        )}
      </div>
    </li>
  );
}
