'use client';

// /settings/vendor-access surfaces the Vendor Support Access Lockbox.
//
// Procurement reviewers ask for one thing here: prove that vendor
// support cannot read this workspace unless an owner has explicitly
// and recently opened a time-bound door. This page is that proof.
// Defaults are "lockbox closed", grants are time-bound, every change
// hits the audit log, and the response header X-Vendor-Access-Lockbox
// is documented inline so an IT admin can monitor it externally.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  type VendorAccessPolicy,
  type VendorAccessGrant,
} from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconShield,
  IconKey,
  IconCheck,
  IconWarning,
  IconArrowRight,
  IconRefresh,
  IconClockCountdown,
} from '@clawmind/ui';

function fmt(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

function fmtCountdown(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'expired';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}h ${m}m ${ss}s`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}

export default function VendorAccessPage() {
  const [policy, setPolicy] = useState<VendorAccessPolicy | null>(null);
  const [current, setCurrent] = useState<VendorAccessGrant | null>(null);
  const [history, setHistory] = useState<VendorAccessGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [maxDurationSec, setMaxDurationSec] = useState(3600);
  const [requireJustification, setRequireJustification] = useState(true);
  const [requireTicket, setRequireTicket] = useState(false);

  const [durationSec, setDurationSec] = useState(900);
  const [reason, setReason] = useState('');
  const [ticket, setTicket] = useState('');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const [savingPolicy, setSavingPolicy] = useState(false);
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await api.vendorAccessGet();
      setPolicy(s.policy);
      setCurrent(s.current);
      setHistory(s.history);
      setEnabled(s.policy.enabled);
      setMaxDurationSec(s.policy.maxDurationSec);
      setRequireJustification(s.policy.requireJustification);
      setRequireTicket(s.policy.requireTicket);
      if (s.policy.maxDurationSec < durationSec) {
        setDurationSec(s.policy.maxDurationSec);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You do not have permission to view vendor access settings.');
      } else {
        setError(err instanceof Error ? err.message : 'failed to load');
      }
    } finally {
      setLoading(false);
    }
    // We intentionally omit durationSec so reload does not fight user edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const savePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setSavingPolicy(true);
    try {
      const next = await api.vendorAccessUpdatePolicy({
        enabled,
        maxDurationSec,
        requireJustification,
        requireTicket,
      });
      setPolicy(next);
      // If the user just turned the lockbox off, the server revoked any
      // active grant. Reload to surface the new state.
      if (!next.enabled) await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? `${err.status}: ${err.message}` : err instanceof Error ? err.message : 'save failed',
      );
    } finally {
      setSavingPolicy(false);
    }
  };

  const grant = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setIssuedToken(null);
    setGranting(true);
    try {
      const res = await api.vendorAccessGrant({
        durationSec,
        reason: reason.trim() === '' ? null : reason.trim(),
        ticket: ticket.trim() === '' ? null : ticket.trim(),
      });
      setCurrent(res.grant);
      setIssuedToken(res.token);
      setReason('');
      setTicket('');
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? `${err.status}: ${err.message}` : err instanceof Error ? err.message : 'grant failed',
      );
    } finally {
      setGranting(false);
    }
  };

  const revoke = async () => {
    setActionError(null);
    setRevoking(true);
    try {
      await api.vendorAccessRevoke();
      setIssuedToken(null);
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? `${err.status}: ${err.message}` : err instanceof Error ? err.message : 'revoke failed',
      );
    } finally {
      setRevoking(false);
    }
  };

  const lockboxOpen = !!(current && current.revokedAt === null && current.expiresAt > Date.now());
  // tick is referenced so the countdown re-renders every second.
  void tick;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <TopNav />
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link href="/settings" className="hover:text-foreground">Settings</Link>
              <IconArrowRight className="h-3.5 w-3.5" />
              <span>Vendor Support Access</span>
            </div>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <IconShield className="h-6 w-6" />
              Vendor Support Access Lockbox
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Default-closed. Vendor support engineers cannot read this workspace
              unless you mint a time-bound grant. Every grant is audited with the
              actor, reason, ticket, expiry, and use count. Every API response
              carries <code className="rounded bg-muted px-1 py-0.5 text-xs">X-Vendor-Access-Lockbox</code> so
              your SIEM can verify the door is shut.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
          >
            <IconRefresh className="h-4 w-4" /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading
          </div>
        ) : error ? (
          <ErrorState title="Could not load" message={error} />
        ) : !policy ? (
          <EmptyState
            icon={<IconShield />}
            title="Not configured"
            body="No vendor access policy returned."
          />
        ) : (
          <div className="space-y-8">
            <section
              className={`rounded-lg border p-4 ${
                lockboxOpen
                  ? 'border-amber-500/40 bg-amber-500/5'
                  : 'border-emerald-500/40 bg-emerald-500/5'
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                {lockboxOpen ? (
                  <>
                    <IconWarning className="h-5 w-5 text-amber-500" />
                    Lockbox OPEN
                  </>
                ) : (
                  <>
                    <IconCheck className="h-5 w-5 text-emerald-500" />
                    Lockbox CLOSED
                  </>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {lockboxOpen && current
                  ? `Vendor support can access this workspace until ${fmt(current.expiresAt)} (${fmtCountdown(current.expiresAt)}).`
                  : 'No vendor support session can read this workspace right now.'}
              </p>
            </section>

            <section className="rounded-lg border border-border p-5">
              <h2 className="text-lg font-medium">Policy</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Owner-only. Disabling the lockbox immediately revokes any active grant.
              </p>
              {actionError && (
                <div className="mt-3 rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {actionError}
                </div>
              )}
              <form onSubmit={savePolicy} className="mt-4 space-y-4">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                  />
                  <span className="text-sm">
                    <span className="font-medium">Enable lockbox.</span>{' '}
                    When off, grants cannot be created at all.
                  </span>
                </label>
                <label className="block text-sm">
                  <span className="font-medium">Max grant duration (seconds)</span>
                  <input
                    type="number"
                    min={60}
                    max={86400}
                    value={maxDurationSec}
                    onChange={(e) => setMaxDurationSec(Number(e.target.value))}
                    className="mt-1 w-40 rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                  <span className="ml-2 text-xs text-muted-foreground">
                    Hard ceiling: 86400 (24h)
                  </span>
                </label>
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={requireJustification}
                    onChange={(e) => setRequireJustification(e.target.checked)}
                  />
                  <span className="text-sm">Require a written reason on every grant.</span>
                </label>
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={requireTicket}
                    onChange={(e) => setRequireTicket(e.target.checked)}
                  />
                  <span className="text-sm">Require an external ticket reference (Jira, ServiceNow, etc).</span>
                </label>
                <button
                  type="submit"
                  disabled={savingPolicy}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {savingPolicy ? <Spinner /> : <IconCheck className="h-4 w-4" />}
                  Save policy
                </button>
              </form>
            </section>

            <section className="rounded-lg border border-border p-5">
              <h2 className="flex items-center gap-2 text-lg font-medium">
                <IconKey className="h-5 w-5" /> Mint a grant
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Returns a token exactly once. Hand it to the support engineer over a secure channel.
                They present it via the <code className="rounded bg-muted px-1 py-0.5 text-xs">X-Vendor-Support-Token</code> header.
              </p>
              {!policy.enabled && (
                <div className="mt-3 rounded border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
                  Lockbox is disabled. Enable it in the policy above to mint a grant.
                </div>
              )}
              <form onSubmit={grant} className="mt-4 space-y-4">
                <label className="block text-sm">
                  <span className="font-medium">Duration (seconds)</span>
                  <input
                    type="number"
                    min={60}
                    max={policy.maxDurationSec}
                    value={durationSec}
                    onChange={(e) => setDurationSec(Number(e.target.value))}
                    className="mt-1 w-40 rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                  <span className="ml-2 text-xs text-muted-foreground">
                    Policy max: {policy.maxDurationSec}s
                  </span>
                </label>
                <label className="block text-sm">
                  <span className="font-medium">
                    Reason {policy.requireJustification && <span className="text-destructive">*</span>}
                  </span>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    maxLength={1000}
                    placeholder="Why does support need read access right now?"
                    className="mt-1 block w-full rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">
                    Ticket {policy.requireTicket && <span className="text-destructive">*</span>}
                  </span>
                  <input
                    type="text"
                    value={ticket}
                    onChange={(e) => setTicket(e.target.value)}
                    maxLength={200}
                    placeholder="e.g. INC-1042"
                    className="mt-1 block w-full rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                </label>
                <button
                  type="submit"
                  disabled={granting || !policy.enabled}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {granting ? <Spinner /> : <IconClockCountdown className="h-4 w-4" />}
                  Mint grant
                </button>
              </form>

              {issuedToken && (
                <div className="mt-4 rounded border border-amber-500/40 bg-amber-500/5 p-3">
                  <div className="text-sm font-medium">Token (shown once)</div>
                  <code className="mt-1 block break-all rounded bg-background px-2 py-1 font-mono text-xs">
                    {issuedToken}
                  </code>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Copy this now. It cannot be retrieved later. Closing this page or refreshing wipes it from view.
                  </p>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-border p-5">
              <h2 className="text-lg font-medium">Current grant</h2>
              {current ? (
                <div className="mt-3 space-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Granted by:</span> {current.grantedBy}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Reason:</span> {current.reason ?? '(none)'}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Ticket:</span> {current.ticket ?? '(none)'}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Expires:</span> {fmt(current.expiresAt)} ({fmtCountdown(current.expiresAt)})
                  </div>
                  <div>
                    <span className="text-muted-foreground">Last used:</span> {fmt(current.lastUsedAt)} ({current.useCount} requests)
                  </div>
                  <button
                    type="button"
                    onClick={revoke}
                    disabled={revoking}
                    className="mt-3 inline-flex items-center gap-1 rounded-md border border-destructive/60 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    {revoking ? <Spinner /> : <IconWarning className="h-4 w-4" />}
                    Revoke now
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No active grant.</p>
              )}
            </section>

            <section className="rounded-lg border border-border p-5">
              <h2 className="text-lg font-medium">History</h2>
              {history.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No past grants.</p>
              ) : (
                <ul className="mt-3 divide-y divide-border text-sm">
                  {history.slice(0, 25).map((g) => (
                    <li key={g.id} className="py-2">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="font-mono text-xs text-muted-foreground">{g.id}</span>
                        <span>by {g.grantedBy}</span>
                        <span className="text-muted-foreground">{fmt(g.createdAt)}</span>
                        <span className="text-muted-foreground">
                          {g.revokedAt ? `revoked ${fmt(g.revokedAt)}` : `expired ${fmt(g.expiresAt)}`}
                        </span>
                        <span className="text-muted-foreground">{g.useCount} uses</span>
                      </div>
                      {(g.reason || g.ticket) && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {g.reason && <span>reason: {g.reason}</span>}
                          {g.reason && g.ticket && <span> · </span>}
                          {g.ticket && <span>ticket: {g.ticket}</span>}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
