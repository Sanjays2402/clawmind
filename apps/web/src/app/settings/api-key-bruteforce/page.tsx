'use client';

// Admin view of the API-key brute-force throttle.
//
// What it shows: every source IP the auth layer has seen recent failed
// Bearer verifications from, which of those are currently locked, and the
// last 100 events from the throttle log. The page is read-gated to
// admin:read; the per-row Unlock button posts a DELETE that the API gates
// to owner + MFA, so an admin who is not the owner can monitor but cannot
// clear locks during an active incident.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, ApiError, fmtRelative } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  SettingsCardSkeleton,
  Spinner,
  IconArrowRight,
  IconCheck,
  IconKey,
  IconRefresh,
  IconShield,
  IconWarning,
} from '@clawmind/ui';

interface IpRow {
  ip: string;
  locked: boolean;
  recent: number;
  lockedUntil: number;
  totalFails: number;
  totalLocks: number;
  lastReason: string | null;
}

interface LogRow {
  ts: number;
  event: 'fail' | 'lock' | 'unlock';
  ip: string;
  reason: string;
  recent: number;
  lockedUntil: number;
}

interface Snapshot {
  config: { maxFails: number; windowMs: number; lockoutMs: number };
  ips: IpRow[];
  recent: LogRow[];
  summary: { tracked: number; locked: number };
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return `${h}h`;
}

// Throttle-log event chips route through the brand feedback inks: a lock
// firing is an incident signal (danger), an unlock is a recovery
// (success), a bare fail is routine noise (neutral).
function eventChipClass(event: LogRow['event']): string {
  switch (event) {
    case 'lock':
      return 'rounded-full border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] px-2 py-0.5 text-[11px] text-cm-danger';
    case 'unlock':
      return 'rounded-full border border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] px-2 py-0.5 text-[11px] text-cm-success';
    default:
      return 'rounded-full border border-cm-border bg-cm-subtle px-2 py-0.5 text-[11px] text-cm-muted';
  }
}

export default function ApiKeyBruteForcePage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [clearingIp, setClearingIp] = useState<string | null>(null);
  const [clearedIp, setClearedIp] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.apiKeyBruteForceGet();
      setSnap(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You need the admin role to view the brute-force monitor.');
      } else if (err instanceof ApiError && err.status === 401) {
        setError('Sign in to view the brute-force monitor.');
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

  async function onUnlock(ip: string) {
    if (!confirm(`Clear lockout for ${ip}?`)) return;
    setClearingIp(ip);
    setActionError(null);
    try {
      await api.apiKeyBruteForceUnlock(ip);
      setClearedIp(ip);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setActionError('Only the workspace owner with MFA can clear locks.');
      } else if (err instanceof ApiError && err.status === 412) {
        setActionError('MFA step-up required. Verify in Settings then retry.');
      } else if (err instanceof ApiError && err.status === 404) {
        setActionError('That IP is no longer tracked.');
      } else {
        setActionError(err instanceof Error ? err.message : 'unlock failed');
      }
    } finally {
      setClearingIp(null);
    }
  }

  // Posture at a glance: any IP locked right now means an active attack is
  // being blocked (danger); otherwise the throttle is armed and clear.
  const underAttack = (snap?.summary.locked ?? 0) > 0;

  return (
    <div className="min-h-screen bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <nav className="mb-6 flex items-center gap-2 text-xs text-cm-muted">
          <Link href="/settings" className="hover:text-cm-fg hover:underline">
            Settings
          </Link>
          <IconArrowRight size={12} />
          <span className="text-cm-fg">API key brute-force</span>
        </nav>

        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="rounded-md border border-cm-border bg-cm-subtle p-2 text-cm-accent">
              <IconShield size={22} />
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                API key brute-force monitor
              </h1>
              <p className="mt-1 text-sm text-cm-muted">
                Source IPs that fail too many Bearer verifications in a short window are blocked
                with 429 before the next attempt reaches the key store.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:bg-cm-subtle hover:text-cm-fg disabled:opacity-50"
            aria-label="Refresh"
          >
            <IconRefresh size={14} />
            Refresh
          </button>
        </div>

        {loading && !snap ? (
          <SettingsCardSkeleton rows={4} />
        ) : error ? (
          <ErrorState title="Could not load" message={error} onRetry={load} />
        ) : snap ? (
          <div className="grid gap-6">
            <section className="rounded-xl border border-cm-border bg-cm-paper p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium text-cm-fg">
                  <IconKey size={14} />
                  Policy
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${
                    underAttack
                      ? 'border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] text-cm-danger'
                      : 'border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] text-cm-success'
                  }`}
                >
                  {underAttack ? <IconWarning size={12} /> : <IconCheck size={12} />}
                  {underAttack ? 'Lockout active' : 'Armed and clear'}
                </span>
              </div>
              <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-cm-muted">
                    Lockout threshold
                  </dt>
                  <dd className="mt-1 cm-mono text-cm-fg">
                    {snap.config.maxFails} failures
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-cm-muted">
                    Window
                  </dt>
                  <dd className="mt-1 cm-mono text-cm-fg">
                    {fmtDuration(snap.config.windowMs)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-cm-muted">
                    Lock duration
                  </dt>
                  <dd className="mt-1 cm-mono text-cm-fg">
                    {fmtDuration(snap.config.lockoutMs)}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-4 border-t border-cm-border pt-4 text-sm text-cm-muted">
                <span>
                  Tracked IPs: <span className="cm-mono text-cm-fg">{snap.summary.tracked}</span>
                </span>
                <span>
                  Currently locked:{' '}
                  <span className={underAttack ? 'cm-mono text-cm-danger' : 'cm-mono text-cm-fg'}>
                    {snap.summary.locked}
                  </span>
                </span>
              </div>
            </section>

            {actionError ? (
              <div className="flex items-start gap-2 rounded-lg border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] p-3 text-sm text-cm-danger">
                <IconWarning size={14} className="mt-0.5 shrink-0" />
                <span>{actionError}</span>
              </div>
            ) : null}

            {clearedIp ? (
              <div className="flex items-center gap-2 rounded-lg border border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] p-3 text-sm text-cm-success">
                <IconCheck size={14} className="shrink-0" />
                <span>Cleared lockout for {clearedIp}.</span>
              </div>
            ) : null}

            <section>
              <h2 className="mb-3 text-sm font-medium text-cm-fg">Source IPs</h2>
              {snap.ips.length === 0 ? (
                <EmptyState
                  title="No failed attempts on record"
                  body="The throttle has not seen a failed Bearer verification since this pod started."
                />
              ) : (
                <div className="overflow-hidden rounded-xl border border-cm-border bg-cm-paper">
                  <table className="w-full text-sm">
                    <thead className="bg-cm-subtle text-left text-[11px] uppercase tracking-wide text-cm-muted">
                      <tr>
                        <th className="px-3 py-2">IP</th>
                        <th className="px-3 py-2">State</th>
                        <th className="px-3 py-2 text-right">Recent</th>
                        <th className="px-3 py-2 text-right">Total fails</th>
                        <th className="px-3 py-2">Last reason</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {snap.ips.map((row) => (
                        <tr key={row.ip} className="border-t border-cm-border">
                          <td className="px-3 py-2 cm-mono text-cm-fg">{row.ip}</td>
                          <td className="px-3 py-2">
                            {row.locked ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] px-2 py-0.5 text-[11px] text-cm-danger">
                                locked until {fmtDate(row.lockedUntil)}
                              </span>
                            ) : row.recent > 0 ? (
                              <span className="text-cm-cite">tracking</span>
                            ) : (
                              <span className="text-cm-muted">clear</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right cm-mono text-cm-fg">{row.recent}</td>
                          <td className="px-3 py-2 text-right cm-mono text-cm-fg">{row.totalFails}</td>
                          <td className="px-3 py-2 text-cm-muted">{row.lastReason ?? '-'}</td>
                          <td className="px-3 py-2 text-right">
                            {row.locked ? (
                              <button
                                type="button"
                                onClick={() => onUnlock(row.ip)}
                                disabled={clearingIp === row.ip}
                                className="inline-flex items-center gap-1 rounded-md border border-cm-border px-2 py-1 text-xs text-cm-fg hover:bg-cm-subtle disabled:opacity-50"
                              >
                                {clearingIp === row.ip ? 'Clearing' : 'Unlock'}
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-3 text-sm font-medium text-cm-fg">Recent events</h2>
              {snap.recent.length === 0 ? (
                <EmptyState title="Quiet" body="No throttle events on record yet." />
              ) : (
                <ul className="divide-y divide-cm-border rounded-xl border border-cm-border bg-cm-paper text-sm">
                  {snap.recent.map((e, i) => (
                    <li key={`${e.ts}-${i}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className={eventChipClass(e.event)}>{e.event}</span>
                      <span className="cm-mono text-cm-fg">{e.ip}</span>
                      <span className="text-cm-muted">{e.reason}</span>
                      <span className="ml-auto text-[11px] text-cm-muted">
                        {fmtRelative(e.ts)}
                      </span>
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
