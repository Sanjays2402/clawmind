'use client';

// Dual-control (four-eyes) approval console.
//
// Owners use this page to review destructive admin actions that another
// owner has requested but cannot execute alone. The most sensitive of
// those today is workspace scheduled deletion (POST /v1/workspace/deletion)
// which the API now refuses without an approval id minted here.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, ApiError, fmtRelative, type DualControlRequest } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  Button,
  IconShield,
  IconCheck,
  IconWarning,
  IconRefresh,
  IconArrowRight,
} from '@clawmind/ui';

type Tab = 'pending' | 'all';

function StateBadge({ s }: { s: DualControlRequest['state'] }) {
  const tone =
    s === 'pending'
      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
      : s === 'approved'
        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
        : s === 'consumed'
          ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
          : s === 'rejected'
            ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
            : 'bg-[var(--surface)] text-[var(--muted)]';
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
      {s}
    </span>
  );
}

export default function ApprovalsPage() {
  const [items, setItems] = useState<DualControlRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.dualControlList();
      setItems(r.items);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Sign in as an admin to view approvals.');
      } else if (err instanceof ApiError && err.status === 403) {
        setError('Owner role required.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load approvals.');
      }
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (id: string, kind: 'approve' | 'reject') => {
      setBusyId(id);
      try {
        if (kind === 'approve') await api.dualControlApprove(id);
        else await api.dualControlReject(id);
        await load();
      } catch (err) {
        const msg =
          err instanceof ApiError && err.status === 409
            ? (err.body as any)?.message ?? 'Approval is no longer pending.'
            : err instanceof Error
              ? err.message
              : 'Action failed.';
        setError(msg);
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const view = items ?? [];
  const filtered = tab === 'pending' ? view.filter((r) => r.state === 'pending') : view;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <TopNav />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[var(--muted)]">
              <IconShield size={18} />
              <span className="text-xs uppercase tracking-wide">Security</span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold">Dual control approvals</h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
              Destructive admin actions require a second owner&apos;s approval
              (NIST AC-3(2) two-person integrity). The same human cannot both
              request and approve, nor approve and execute.
            </p>
          </div>
          <Button variant="ghost" onClick={() => void load()} aria-label="Refresh">
            <IconRefresh size={16} />
            <span className="ml-1.5 hidden sm:inline">Refresh</span>
          </Button>
        </header>

        <div className="mb-4 flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] p-1 text-sm">
          {(['pending', 'all'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1.5 transition ${
                tab === t
                  ? 'bg-[var(--bg)] text-[var(--fg)] shadow-sm'
                  : 'text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              {t === 'pending' ? 'Pending' : 'All'}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4">
            <ErrorState message={error} onRetry={() => void load()} />
          </div>
        )}

        {items === null && (
          <div className="flex items-center justify-center py-12">
            <Spinner />
          </div>
        )}

        {items !== null && filtered.length === 0 && (
          <EmptyState
            icon={<IconCheck size={28} />}
            title={tab === 'pending' ? 'No pending approvals' : 'No approval history yet'}
            body={
              tab === 'pending'
                ? 'When another owner schedules a destructive admin action, it will appear here.'
                : 'Approval requests will show up here as soon as someone tries a guarded action.'
            }
          />
        )}

        {items !== null && filtered.length > 0 && (
          <ul className="space-y-3">
            {filtered.map((r) => (
              <li
                key={r.id}
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm">{r.action}</span>
                      <StateBadge s={r.state} />
                    </div>
                    <div className="mt-1 truncate text-xs text-[var(--muted)]">
                      <span className="font-mono">{r.resource}</span>
                    </div>
                    <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                      <div className="flex gap-1">
                        <dt className="text-[var(--muted)]">id</dt>
                        <dd className="truncate font-mono">{r.id}</dd>
                      </div>
                      <div className="flex gap-1">
                        <dt className="text-[var(--muted)]">requested</dt>
                        <dd>
                          {fmtRelative(r.requestedAt)} by{' '}
                          <span className="font-mono">{r.requestedBy}</span>
                        </dd>
                      </div>
                      {r.state === 'pending' && (
                        <div className="flex gap-1">
                          <dt className="text-[var(--muted)]">expires</dt>
                          <dd>{fmtRelative(r.expiresAt)}</dd>
                        </div>
                      )}
                      {r.approvedBy && (
                        <div className="flex gap-1">
                          <dt className="text-[var(--muted)]">approved</dt>
                          <dd>
                            {fmtRelative(r.approvedAt ?? 0)} by{' '}
                            <span className="font-mono">{r.approvedBy}</span>
                          </dd>
                        </div>
                      )}
                      {r.rejectedBy && (
                        <div className="flex gap-1">
                          <dt className="text-[var(--muted)]">rejected</dt>
                          <dd>
                            {fmtRelative(r.rejectedAt ?? 0)} by{' '}
                            <span className="font-mono">{r.rejectedBy}</span>
                          </dd>
                        </div>
                      )}
                      {r.consumedBy && (
                        <div className="flex gap-1">
                          <dt className="text-[var(--muted)]">executed</dt>
                          <dd>
                            {fmtRelative(r.consumedAt ?? 0)} by{' '}
                            <span className="font-mono">{r.consumedBy}</span>
                          </dd>
                        </div>
                      )}
                      {r.reason && (
                        <div className="col-span-2 flex gap-1">
                          <dt className="text-[var(--muted)]">reason</dt>
                          <dd className="break-words">{r.reason}</dd>
                        </div>
                      )}
                    </dl>
                  </div>
                  {r.state === 'pending' && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="primary"
                        onClick={() => void act(r.id, 'approve')}
                        disabled={busyId === r.id}
                      >
                        <IconCheck size={16} />
                        <span className="ml-1.5">Approve</span>
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => void act(r.id, 'reject')}
                        disabled={busyId === r.id}
                      >
                        <IconWarning size={16} />
                        <span className="ml-1.5">Reject</span>
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-8 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <IconShield size={16} />
            How it works
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-[var(--muted)]">
            <li>
              Owner A calls a guarded action (today: POST /v1/workspace/deletion).
              The API mints a pending approval and returns 412 with the id.
            </li>
            <li>Owner B opens this page and approves the request.</li>
            <li>
              Owner A re-sends the original call with{' '}
              <span className="font-mono text-[var(--fg)]">X-DualControl-Approval: &lt;id&gt;</span>.
              The API consumes the approval and runs the action.
            </li>
          </ol>
          <div className="mt-3">
            <Link
              href="/admin"
              className="inline-flex items-center gap-1 text-[var(--fg)] hover:underline"
            >
              Back to admin console <IconArrowRight size={14} />
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
