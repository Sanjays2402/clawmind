'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, type ActiveSession, fmtRelative } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconKey,
  IconShield,
  IconTrash,
  IconCheck,
  IconWarning,
  IconArrowRight,
  IconSettings,
} from '@clawmind/ui';

function fmtAbsolute(ts: number): string {
  return new Date(ts).toLocaleString();
}

function shortAgent(ua: string): string {
  // Pull out the recognisable browser + OS bits; fall back to a truncated UA.
  const browser = /(Firefox|Edg|Chrome|Safari)\/[\d.]+/.exec(ua)?.[1];
  const os = /\(([^)]+)\)/.exec(ua)?.[1]?.split(';')[0]?.trim();
  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  return ua.length > 80 ? `${ua.slice(0, 77)}...` : ua;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.sessionsList();
      setSessions(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const revokeOne = async (s: ActiveSession) => {
    if (s.current) return;
    setBusyId(s.id);
    setActionError(null);
    setActionMessage(null);
    try {
      await api.sessionsRevoke(s.id);
      setActionMessage('Session revoked. It will be rejected on its next request.');
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'revoke failed');
    } finally {
      setBusyId(null);
    }
  };

  const revokeAll = async () => {
    if (!confirm('Sign out every other browser? This cannot be undone.')) return;
    setRevokingAll(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const out = await api.sessionsRevokeAll(true);
      setActionMessage(
        out.revoked === 0
          ? 'No other active sessions to revoke.'
          : `Revoked ${out.revoked} other session${out.revoked === 1 ? '' : 's'}.`,
      );
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'revoke-all failed');
    } finally {
      setRevokingAll(false);
    }
  };

  const active = sessions?.filter((s) => !s.revokedAt) ?? [];
  const recentlyRevoked = sessions?.filter((s) => s.revokedAt) ?? [];
  const otherCount = active.filter((s) => !s.current).length;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="rounded-md border bg-muted/30 p-2 text-primary">
              <IconKey size={22} />
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Active sessions</h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Every browser currently signed in to your account. Revoke any
                one of them, or sign out everywhere else if you think a device
                was lost.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Link
              href="/settings"
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 hover:bg-muted/50"
            >
              <IconSettings size={14} />
              Settings
            </Link>
            <Link
              href="/settings/security"
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 hover:bg-muted/50"
            >
              <IconShield size={14} />
              IP allowlist
            </Link>
            <Link
              href="/audit"
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 hover:bg-muted/50"
            >
              Audit log
              <IconArrowRight size={14} />
            </Link>
          </div>
        </header>

        {loading && (
          <div className="rounded-lg border bg-card p-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner size={14} />
              Loading sessions
            </div>
          </div>
        )}

        {!loading && error && (
          <ErrorState title="Could not load sessions" message={error} onRetry={load} />
        )}

        {!loading && !error && sessions && (
          <div className="space-y-6">
            {actionMessage && (
              <div
                role="status"
                className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
              >
                <IconCheck size={16} />
                <span>{actionMessage}</span>
              </div>
            )}
            {actionError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
              >
                <IconWarning size={16} />
                <span>{actionError}</span>
              </div>
            )}

            <section className="rounded-lg border bg-card">
              <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div>
                  <h2 className="text-sm font-medium">
                    {active.length} active {active.length === 1 ? 'session' : 'sessions'}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Includes this browser. Revoking takes effect on the next request.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={revokeAll}
                  disabled={revokingAll || otherCount === 0}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-destructive/40 px-3 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {revokingAll ? <Spinner size={14} /> : <IconTrash size={14} />}
                  Sign out everywhere else
                </button>
              </div>

              {active.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No active sessions"
                    body="Sign in again to see this list populate."
                  />
                </div>
              ) : (
                <ul className="divide-y">
                  {active.map((s) => (
                    <li key={s.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{shortAgent(s.userAgent)}</span>
                          {s.current && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
                              <IconCheck size={11} />
                              This browser
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>IP {s.ip}</span>
                          <span>Last seen {fmtRelative(s.lastSeenAt)}</span>
                          <span title={fmtAbsolute(s.createdAt)}>
                            Signed in {fmtRelative(s.createdAt)}
                          </span>
                          <span className="font-mono text-[11px] opacity-70">id {s.id}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => revokeOne(s)}
                        disabled={s.current || busyId === s.id}
                        title={s.current ? 'Use the sign-out button in the nav to end this session.' : 'Revoke this session'}
                        className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-sm hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyId === s.id ? <Spinner size={14} /> : <IconTrash size={14} />}
                        Revoke
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {recentlyRevoked.length > 0 && (
              <section className="rounded-lg border bg-card">
                <div className="border-b p-4 sm:p-5">
                  <h2 className="text-sm font-medium">Recently revoked</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Kept for 24 hours so you can confirm the action took effect.
                  </p>
                </div>
                <ul className="divide-y">
                  {recentlyRevoked.map((s) => (
                    <li key={s.id} className="p-4 sm:p-5">
                      <div className="text-sm font-medium text-muted-foreground line-through">
                        {shortAgent(s.userAgent)}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>IP {s.ip}</span>
                        <span>Revoked {fmtRelative(s.revokedAt!)}</span>
                        <span className="font-mono text-[11px] opacity-70">id {s.id}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
