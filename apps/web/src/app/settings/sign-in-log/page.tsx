'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, fmtRelative, type SignInRecord, type SignInListResult } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconShield,
  IconCheck,
  IconWarning,
  IconArrowRight,
  IconSettings,
  IconRefresh,
} from '@clawmind/ui';

type Scope = 'self' | 'all';
type OutcomeFilter = '' | 'success' | 'failure' | 'logout';

function fmtAbsolute(ts: number): string {
  return new Date(ts).toLocaleString();
}

function shortAgent(ua: string): string {
  if (!ua) return 'unknown client';
  const browser = /(Firefox|Edg|Chrome|Safari)\/[\d.]+/.exec(ua)?.[1];
  const os = /\(([^)]+)\)/.exec(ua)?.[1]?.split(';')[0]?.trim();
  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  return ua.length > 80 ? `${ua.slice(0, 77)}...` : ua;
}

// Outcomes route through the brand feedback inks: a clean sign-in reads as
// --cm-success (green), a failed attempt as the citation gold caution ink
// (it is a signal to look, not a hard error), and a sign-out as calm neutral.
function OutcomeBadge({ outcome }: { outcome: SignInRecord['outcome'] }) {
  const map: Record<SignInRecord['outcome'], { label: string; cls: string; icon: React.ReactNode }> = {
    success: {
      label: 'Success',
      cls: 'border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] text-[var(--cm-success)]',
      icon: <IconCheck size={11} />,
    },
    failure: {
      label: 'Failed',
      cls: 'border-[var(--cm-cite-line)] bg-[var(--cm-cite-bg)] text-cm-cite',
      icon: <IconWarning size={11} />,
    },
    logout: {
      label: 'Signed out',
      cls: 'border-cm-border bg-cm-subtle text-cm-muted',
      icon: <IconArrowRight size={11} />,
    },
  };
  const m = map[outcome];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${m.cls}`}>
      {m.icon}
      {m.label}
    </span>
  );
}

export default function SignInLogPage() {
  const [scope, setScope] = useState<Scope>('self');
  const [outcome, setOutcome] = useState<OutcomeFilter>('');
  const [data, setData] = useState<SignInListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adminBlocked, setAdminBlocked] = useState(false);

  const load = useCallback(
    async (nextScope: Scope = scope, nextOutcome: OutcomeFilter = outcome) => {
      setLoading(true);
      setError(null);
      try {
        const params = nextOutcome ? { outcome: nextOutcome, limit: 100 } : { limit: 100 };
        const out = nextScope === 'all'
          ? await api.signInLogListAll(params)
          : await api.signInLogList(params);
        setData(out);
        setAdminBlocked(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'failed to load';
        if (nextScope === 'all' && /403|forbidden|role required/i.test(msg)) {
          setAdminBlocked(true);
          setData({ records: [], nextCursor: null, total: 0 });
        } else {
          setError(msg);
        }
      } finally {
        setLoading(false);
      }
    },
    [scope, outcome],
  );

  useEffect(() => {
    load(scope, outcome);
  }, [load, scope, outcome]);

  const summary = useMemo(() => {
    if (!data) return null;
    const failures = data.records.filter((r) => r.outcome === 'failure').length;
    const successes = data.records.filter((r) => r.outcome === 'success').length;
    return { failures, successes, total: data.total };
  }, [data]);

  return (
    <div className="min-h-screen bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-10">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="rounded-md border border-cm-border bg-cm-subtle p-2 text-cm-accent">
              <IconShield size={22} />
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Sign-in activity</h1>
              <p className="mt-1 max-w-xl text-sm text-cm-muted">
                Every login attempt against your account, recorded server side. Switch to the
                workspace view to see failures and probes that did not resolve to a user.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-cm-muted">
            <Link
              href="/settings/sessions"
              className="inline-flex items-center gap-1 rounded-md border border-cm-border px-2.5 py-1.5 hover:bg-cm-subtle"
            >
              <IconSettings size={14} />
              Active sessions
            </Link>
            <Link
              href="/audit"
              className="inline-flex items-center gap-1 rounded-md border border-cm-border px-2.5 py-1.5 hover:bg-cm-subtle"
            >
              Audit log
              <IconArrowRight size={14} />
            </Link>
          </div>
        </header>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Scope" className="inline-flex rounded-md border border-cm-border bg-cm-paper p-0.5 text-xs">
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'self'}
              onClick={() => setScope('self')}
              className={`rounded px-2.5 py-1 ${scope === 'self' ? 'bg-cm-subtle font-medium text-cm-fg' : 'text-cm-muted hover:text-cm-fg'}`}
            >
              My sign-ins
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'all'}
              onClick={() => setScope('all')}
              className={`rounded px-2.5 py-1 ${scope === 'all' ? 'bg-cm-subtle font-medium text-cm-fg' : 'text-cm-muted hover:text-cm-fg'}`}
            >
              Workspace (admin)
            </button>
          </div>

          <label className="inline-flex items-center gap-1 text-xs text-cm-muted">
            Outcome
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as OutcomeFilter)}
              className="h-7 rounded-md border border-cm-border bg-cm-paper px-2 text-xs text-cm-fg outline-none focus:border-cm-border-strong"
            >
              <option value="">All</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
              <option value="logout">Signed out</option>
            </select>
          </label>

          <button
            type="button"
            onClick={() => load(scope, outcome)}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-cm-border px-2.5 py-1.5 text-xs hover:bg-cm-subtle"
          >
            <IconRefresh size={14} />
            Refresh
          </button>
        </div>

        {loading && (
          <div className="rounded-lg border border-cm-border bg-cm-paper p-6">
            <div className="flex items-center gap-2 text-sm text-cm-muted">
              <Spinner size={14} />
              Loading activity
            </div>
          </div>
        )}

        {!loading && error && (
          <ErrorState title="Could not load activity" message={error} onRetry={() => load(scope, outcome)} />
        )}

        {!loading && !error && adminBlocked && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-[var(--cm-cite-line)] bg-[var(--cm-cite-bg)] p-3 text-sm text-cm-cite"
          >
            <IconWarning size={16} />
            <span>
              The workspace view is restricted to admins and owners. Switch back to My sign-ins, or
              ask an owner to grant your role.
            </span>
          </div>
        )}

        {!loading && !error && !adminBlocked && data && (
          <section className="rounded-lg border border-cm-border bg-cm-paper">
            <div className="flex flex-col gap-3 border-b border-cm-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div>
                <h2 className="text-sm font-medium">
                  {data.records.length} record{data.records.length === 1 ? '' : 's'} shown
                </h2>
                <p className="mt-0.5 text-xs text-cm-muted">
                  {summary
                    ? `${summary.successes} success, ${summary.failures} failed, total in log ${data.total}`
                    : 'Newest first. Records are capped at 5000 on disk.'}
                </p>
              </div>
            </div>

            {data.records.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No sign-ins recorded"
                  body="Sign in once to populate the activity log."
                />
              </div>
            ) : (
              <ul className="divide-y divide-cm-border">
                {data.records.map((r) => (
                  <li key={r.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <OutcomeBadge outcome={r.outcome} />
                        <span className="truncate text-sm font-medium">{r.method}</span>
                        {scope === 'all' && (
                          <span className="truncate text-xs text-cm-muted">{r.actor}</span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-cm-muted">
                        <span>IP {r.ip || 'unknown'}</span>
                        <span>{shortAgent(r.userAgent)}</span>
                        {r.reason && (
                          <span className="text-cm-cite">Reason: {r.reason}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-cm-muted sm:text-right" title={fmtAbsolute(r.at)}>
                      {fmtRelative(r.at)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
