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

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <TopNav />
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <nav className="mb-6 flex items-center gap-2 text-xs text-[var(--fg-muted)]">
          <Link href="/settings" className="hover:underline">
            Settings
          </Link>
          <IconArrowRight size={12} />
          <span className="text-[var(--fg)]">API key brute-force</span>
        </nav>

        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconShield size={22} />
            <div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                API key brute-force monitor
              </h1>
              <p className="mt-1 text-sm text-[var(--fg-muted)]">
                Source IPs that fail too many Bearer verifications in a short window are blocked
                with 429 before the next attempt reaches the key store.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--fg-muted)] hover:bg-[var(--bg-elev)] disabled:opacity-50"
            aria-label="Refresh"
          >
            <IconRefresh size={14} />
            Refresh
          </button>
        </div>

        {loading && !snap ? (
          <div className="flex items-center gap-2 text-sm text-[var(--fg-muted)]">
            <Spinner /> Loading
          </div>
        ) : error ? (
          <ErrorState title="Could not load" message={error} onRetry={load} />
        ) : snap ? (
          <div className="grid gap-6">
            <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <IconKey size={14} />
                Policy
              </div>
              <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-[var(--fg-muted)]">
                    Lockout threshold
                  </dt>
                  <dd className="mt-1 font-mono text-[var(--fg)]">
                    {snap.config.maxFails} failures
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-[var(--fg-muted)]">
                    Window
                  </dt>
                  <dd className="mt-1 font-mono text-[var(--fg)]">
                    {fmtDuration(snap.config.windowMs)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-[var(--fg-muted)]">
                    Lock duration
                  </dt>
                  <dd className="mt-1 font-mono text-[var(--fg)]">
                    {fmtDuration(snap.config.lockoutMs)}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-4 text-sm text-[var(--fg-muted)]">
                <span>
                  Tracked IPs: <span className="font-mono text-[var(--fg)]">{snap.summary.tracked}</span>
                </span>
                <span>
                  Currently locked:{' '}
                  <span
                    className={
                      snap.summary.locked > 0
                        ? 'font-mono text-amber-600 dark:text-amber-400'
                        : 'font-mono text-[var(--fg)]'
                    }
                  >
                    {snap.summary.locked}
                  </span>
                </span>
              </div>
            </section>

            {actionError ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                <IconWarning size={14} className="mt-0.5" />
                <span>{actionError}</span>
              </div>
            ) : null}

            {clearedIp ? (
              <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
                <IconCheck size={14} />
                <span>Cleared lockout for {clearedIp}.</span>
              </div>
            ) : null}

            <section>
              <h2 className="mb-3 text-sm font-medium">Source IPs</h2>
              {snap.ips.length === 0 ? (
                <EmptyState
                  title="No failed attempts on record"
                  body="The throttle has not seen a failed Bearer verification since this pod started."
                />
              ) : (
                <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--bg-elev)] text-left text-[11px] uppercase tracking-wide text-[var(--fg-muted)]">
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
                        <tr key={row.ip} className="border-t border-[var(--border)]">
                          <td className="px-3 py-2 font-mono">{row.ip}</td>
                          <td className="px-3 py-2">
                            {row.locked ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                                locked until {fmtDate(row.lockedUntil)}
                              </span>
                            ) : row.recent > 0 ? (
                              <span className="text-[var(--fg-muted)]">tracking</span>
                            ) : (
                              <span className="text-[var(--fg-muted)]">clear</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{row.recent}</td>
                          <td className="px-3 py-2 text-right font-mono">{row.totalFails}</td>
                          <td className="px-3 py-2 text-[var(--fg-muted)]">{row.lastReason ?? '-'}</td>
                          <td className="px-3 py-2 text-right">
                            {row.locked ? (
                              <button
                                type="button"
                                onClick={() => onUnlock(row.ip)}
                                disabled={clearingIp === row.ip}
                                className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg-elev)] disabled:opacity-50"
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
              <h2 className="mb-3 text-sm font-medium">Recent events</h2>
              {snap.recent.length === 0 ? (
                <EmptyState title="Quiet" body="No throttle events on record yet." />
              ) : (
                <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm">
                  {snap.recent.map((e, i) => (
                    <li key={`${e.ts}-${i}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span
                        className={
                          e.event === 'lock'
                            ? 'rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                            : e.event === 'unlock'
                              ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                              : 'rounded-full bg-[var(--bg-elev)] px-2 py-0.5 text-[11px] text-[var(--fg-muted)]'
                        }
                      >
                        {e.event}
                      </span>
                      <span className="font-mono text-[var(--fg)]">{e.ip}</span>
                      <span className="text-[var(--fg-muted)]">{e.reason}</span>
                      <span className="ml-auto text-[11px] text-[var(--fg-muted)]">
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
