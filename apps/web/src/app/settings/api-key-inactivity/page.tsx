'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  type ApiKeyInactivityPolicy,
  type ApiKeyInactivityLimits,
  type ApiKeyInactivityAtRisk,
} from '@/lib/api';
import {
  ErrorState,
  Spinner,
  IconArrowRight,
  IconKey,
  IconClockCountdown,
  IconWarning,
  IconTrash,
} from '@clawmind/ui';

function fmtDate(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

function fmtRelDays(ts: number | null): string {
  if (!ts) return 'unknown';
  const days = Math.max(0, Math.floor((ts - Date.now()) / (24 * 60 * 60_000)));
  if (days === 0) return 'today';
  if (days === 1) return 'in 1 day';
  return `in ${days} days`;
}

interface FormState {
  idleDays: number;
  warnDays: number;
}

export default function ApiKeyInactivityPage() {
  const [policy, setPolicy] = useState<ApiKeyInactivityPolicy | null>(null);
  const [limits, setLimits] = useState<ApiKeyInactivityLimits | null>(null);
  const [counts, setCounts] = useState<{ activeKeys: number; warnKeys: number; expiredKeys: number } | null>(null);
  const [atRisk, setAtRisk] = useState<ApiKeyInactivityAtRisk[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [lastSweepInfo, setLastSweepInfo] = useState<{
    revoked: number;
    dryRun: boolean;
    at: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.apiKeyInactivityGet();
      setPolicy(res.policy);
      setLimits(res.limits);
      setCounts(res.counts);
      setForm({ idleDays: res.policy.idleDays, warnDays: res.policy.warnDays });
      try {
        const risk = await api.apiKeyInactivityAtRisk();
        setAtRisk(risk.atRisk);
      } catch {
        setAtRisk([]);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You need admin or owner access to view the inactivity policy.');
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

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setActionError(null);
    setSaving(true);
    try {
      const next = await api.apiKeyInactivitySet(form);
      setPolicy(next);
      setSavedAt(Date.now());
      await load();
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

  const runSweep = async (dryRun: boolean) => {
    if (!dryRun) {
      if (
        !window.confirm(
          'Revoke every API key past the idle threshold? This invalidates them immediately.',
        )
      ) {
        return;
      }
    }
    setActionError(null);
    setSweeping(true);
    try {
      const res = await api.apiKeyInactivitySweep({ dryRun });
      setLastSweepInfo({ revoked: res.revokedIds.length, dryRun, at: res.scannedAt });
      await load();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'sweep failed';
      setActionError(msg);
    } finally {
      setSweeping(false);
    }
  };

  const reset = async () => {
    if (
      !window.confirm(
        'Turn off the inactivity sweep? Idle keys will no longer be auto-revoked.',
      )
    ) {
      return;
    }
    setActionError(null);
    setSaving(true);
    try {
      const next = await api.apiKeyInactivitySet({ idleDays: 0, warnDays: 0 });
      setPolicy(next);
      setForm({ idleDays: 0, warnDays: 0 });
      setSavedAt(Date.now());
      await load();
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

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <TopNav />
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
        <nav className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/settings" className="hover:underline">
            Settings
          </Link>
          <IconArrowRight className="h-3 w-3" />
          <span>API key inactivity</span>
        </nav>

        <header className="mb-8 flex items-start gap-3">
          <IconClockCountdown className="mt-1 h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              API key inactivity sweep
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Auto-revoke API keys that nobody has used in a configurable window.
              Required by SOC2 CC6.1 and ISO 27001 A.9.2.5. Tighten this before an
              enterprise security review.
            </p>
          </div>
        </header>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading policy
          </div>
        )}

        {error && !loading && (
          <ErrorState
            title="Unable to load policy"
            message={error}
            onRetry={load}
            retryLabel="Retry"
          />
        )}

        {policy && limits && form && counts && !loading && !error && (
          <div className="space-y-6">
            <section className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border bg-card p-4">
                <div className="text-xs text-muted-foreground">Active keys</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {counts.activeKeys}
                </div>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <div className="text-xs text-muted-foreground">Approaching</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-amber-500">
                  {counts.warnKeys}
                </div>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <div className="text-xs text-muted-foreground">Past idle threshold</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-red-500">
                  {counts.expiredKeys}
                </div>
              </div>
            </section>

            <form onSubmit={save} className="space-y-4">
              <section className="rounded-lg border bg-card p-5">
                <h2 className="text-sm font-semibold">Thresholds</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Idle days counts since the last successful key use. Set to zero to
                  disable the sweep entirely.
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-medium">Idle days</span>
                    <input
                      type="number"
                      min={0}
                      max={limits.maxIdleDays}
                      value={form.idleDays}
                      onChange={(e) =>
                        setForm({ ...form, idleDays: Number(e.target.value) || 0 })
                      }
                      className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    />
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {form.idleDays === 0
                        ? 'disabled'
                        : `revoke after ${form.idleDays} days idle`}
                    </span>
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium">Warn before (days)</span>
                    <input
                      type="number"
                      min={0}
                      max={limits.maxWarnDays}
                      value={form.warnDays}
                      onChange={(e) =>
                        setForm({ ...form, warnDays: Number(e.target.value) || 0 })
                      }
                      className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    />
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {form.warnDays === 0
                        ? 'no warning window'
                        : `flag keys within ${form.warnDays} days of revocation`}
                    </span>
                  </label>
                </div>
              </section>

              {actionError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300"
                >
                  <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? <Spinner /> : <IconKey className="h-4 w-4" />}
                  Save policy
                </button>
                <button
                  type="button"
                  onClick={reset}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
                >
                  Disable sweep
                </button>
                {savedAt && (
                  <span className="text-xs text-muted-foreground">
                    Saved {new Date(savedAt).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </form>

            <section className="rounded-lg border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Sweep now</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Preview first to see which credentials would be revoked. The real
                    sweep invalidates them immediately and writes an audit entry.
                  </p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Last sweep: {fmtDate(policy.lastSweepAt)}
                    {policy.lastSweepAt
                      ? ` (revoked ${policy.lastSweepCount})`
                      : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => runSweep(true)}
                    disabled={sweeping || policy.idleDays === 0}
                    className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                  >
                    {sweeping ? <Spinner /> : null}
                    Dry run
                  </button>
                  <button
                    type="button"
                    onClick={() => runSweep(false)}
                    disabled={sweeping || policy.idleDays === 0}
                    className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    <IconTrash className="h-4 w-4" />
                    Sweep
                  </button>
                </div>
              </div>
              {lastSweepInfo && (
                <div className="mt-3 rounded-md border bg-background p-3 text-xs">
                  {lastSweepInfo.dryRun ? 'Preview' : 'Sweep'} at{' '}
                  {new Date(lastSweepInfo.at).toLocaleTimeString()}:{' '}
                  {lastSweepInfo.dryRun
                    ? `${lastSweepInfo.revoked} key(s) would be revoked.`
                    : `${lastSweepInfo.revoked} key(s) revoked.`}
                </div>
              )}
            </section>

            <section className="rounded-lg border bg-card">
              <div className="flex items-center justify-between border-b p-4">
                <h2 className="text-sm font-semibold">At-risk keys</h2>
                <span className="text-xs text-muted-foreground">
                  {atRisk?.length ?? 0} listed
                </span>
              </div>
              {!atRisk || atRisk.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No keys flagged. {policy.idleDays === 0
                    ? 'Set an idle threshold above to enable the sweep.'
                    : 'Every active key is within the idle window.'}
                </div>
              ) : (
                <ul className="divide-y">
                  {atRisk.map((k) => (
                    <li
                      key={k.id}
                      className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 font-medium">
                          <span className="truncate">{k.label || k.id}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              k.status === 'expired'
                                ? 'bg-red-500/15 text-red-600 dark:text-red-300'
                                : 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
                            }`}
                          >
                            {k.status}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          User {k.userId} · last used {fmtDate(k.lastUsedAt)} ·{' '}
                          {k.ageDays}d idle
                        </div>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        {k.status === 'expired'
                          ? 'Will revoke on next sweep'
                          : `Revokes ${fmtRelDays(k.willRevokeAt)}`}
                      </div>
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
