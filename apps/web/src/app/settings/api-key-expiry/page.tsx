'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  type ApiKeyExpiryPolicy,
  type ApiKeyExpiryLimits,
  type ApiKeyExpiryUpcoming,
} from '@/lib/api';
import {
  ErrorState,
  Spinner,
  IconArrowRight,
  IconKey,
  IconClockCountdown,
  IconWarning,
} from '@clawmind/ui';

function fmtDate(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

function urgencyClass(daysRemaining: number): string {
  if (daysRemaining <= 1) return 'text-red-500';
  if (daysRemaining <= 7) return 'text-amber-500';
  return 'text-muted-foreground';
}

export default function ApiKeyExpiryPage() {
  const [policy, setPolicy] = useState<ApiKeyExpiryPolicy | null>(null);
  const [limits, setLimits] = useState<ApiKeyExpiryLimits | null>(null);
  const [counts, setCounts] = useState<
    { activeKeys: number; keysWithTtl: number; keysExpiringSoon: number } | null
  >(null);
  const [upcoming, setUpcoming] = useState<ApiKeyExpiryUpcoming[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [warnDays, setWarnDays] = useState<number>(14);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.apiKeyExpiryGet();
      setPolicy(res.policy);
      setLimits(res.limits);
      setCounts(res.counts);
      setWarnDays(res.policy.warnDays);
      try {
        const u = await api.apiKeyExpiryUpcoming();
        setUpcoming(u.upcoming);
      } catch {
        setUpcoming([]);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You need admin or owner access to view the expiry policy.');
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
    setActionError(null);
    setSaving(true);
    try {
      const next = await api.apiKeyExpirySet({ warnDays });
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

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <TopNav />
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
        <nav className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/settings" className="hover:underline">
            Settings
          </Link>
          <IconArrowRight className="h-3 w-3" />
          <span>API key expiry</span>
        </nav>

        <header className="mb-8 flex items-start gap-3">
          <IconClockCountdown className="mt-1 h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              API key expiry warnings
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              When a TTL backed key is inside the warning window, every authenticated
              request returns Warning and X-ClawMind-Api-Key-Expires-In-Days headers so
              SDKs can rotate before the credential lapses. The first crossing into
              the window writes one api-key.expiry_warned audit entry per key.
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

        {policy && limits && counts && !loading && !error && (
          <div className="space-y-6">
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-card p-4">
                <div className="text-xs text-muted-foreground">Active keys</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {counts.activeKeys}
                </div>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <div className="text-xs text-muted-foreground">With a TTL</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {counts.keysWithTtl}
                </div>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <div className="text-xs text-muted-foreground">Expiring soon</div>
                <div
                  className={`mt-1 text-2xl font-semibold tabular-nums ${
                    counts.keysExpiringSoon > 0 ? 'text-amber-500' : ''
                  }`}
                >
                  {counts.keysExpiringSoon}
                </div>
              </div>
            </section>

            <form onSubmit={save} className="space-y-4">
              <section className="rounded-lg border bg-card p-5">
                <h2 className="text-sm font-semibold">Warning window</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Days of advance notice surfaced to every authenticated API key
                  request. Zero disables warnings entirely.
                </p>
                <label className="mt-4 block">
                  <span className="text-xs font-medium">Warn before (days)</span>
                  <input
                    type="number"
                    min={0}
                    max={limits.maxWarnDays}
                    value={warnDays}
                    onChange={(e) => setWarnDays(Number(e.target.value) || 0)}
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {warnDays === 0
                      ? 'no warning headers will be sent'
                      : `flag keys expiring within ${warnDays} day${warnDays === 1 ? '' : 's'}`}
                  </span>
                </label>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Last updated {fmtDate(policy.updatedAt)}
                  {policy.updatedBy ? ` by ${policy.updatedBy}` : ''}
                </p>
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
                {savedAt && (
                  <span className="text-xs text-muted-foreground">
                    Saved {new Date(savedAt).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </form>

            <section className="rounded-lg border bg-card p-5">
              <h2 className="text-sm font-semibold">Upcoming expirations</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Active keys with a TTL inside the warning window, soonest first.
                Rotate from the keys page before they lapse.
              </p>
              {upcoming === null ? (
                <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner /> Loading
                </div>
              ) : upcoming.length === 0 ? (
                <div className="mt-4 rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
                  No keys are expiring inside the warning window.
                </div>
              ) : (
                <ul className="mt-4 divide-y rounded-md border">
                  {upcoming.map((k) => (
                    <li
                      key={k.id}
                      className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{k.label}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {k.id.slice(0, 12)} {'\u00b7'} {k.role} {'\u00b7'} owner {k.userId}
                        </div>
                      </div>
                      <div className="text-right">
                        <div
                          className={`text-sm font-semibold tabular-nums ${urgencyClass(k.daysRemaining)}`}
                        >
                          {k.daysRemaining === 0
                            ? 'today'
                            : `${k.daysRemaining} day${k.daysRemaining === 1 ? '' : 's'}`}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {new Date(k.expiresAt).toLocaleString()}
                        </div>
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
