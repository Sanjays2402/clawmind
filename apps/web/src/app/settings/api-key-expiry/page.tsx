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
  SettingsCardSkeleton,
  Spinner,
  IconArrowRight,
  IconKey,
  IconClockCountdown,
  IconWarning,
} from '@clawmind/ui';

// Shared input styling: theme-aware surface + brand focus ring.
const INPUT_CLS =
  'mt-1 w-full rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm text-cm-fg outline-none placeholder:text-cm-faint focus:ring-2 focus:ring-cm-accent';

function fmtDate(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

// Countdown urgency routes through the brand feedback inks: <=1 day is a
// hard danger (about to lapse), inside a week is cite-gold caution, beyond
// that is calm muted.
function urgencyClass(daysRemaining: number): string {
  if (daysRemaining <= 1) return 'text-cm-danger';
  if (daysRemaining <= 7) return 'text-cm-cite';
  return 'text-cm-muted';
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
    <main className="min-h-dvh bg-cm-bg text-cm-fg">
      <TopNav />
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
        <nav className="mb-6 flex items-center gap-2 text-sm text-cm-muted">
          <Link href="/settings" className="hover:text-cm-fg hover:underline">
            Settings
          </Link>
          <IconArrowRight className="h-3 w-3" />
          <span className="text-cm-fg">API key expiry</span>
        </nav>

        <header className="mb-8 flex items-start gap-3">
          <span className="mt-0.5 rounded-md border border-cm-border bg-cm-subtle p-2 text-cm-accent">
            <IconClockCountdown className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              API key expiry warnings
            </h1>
            <p className="mt-1 text-sm text-cm-muted">
              When a TTL backed key is inside the warning window, every authenticated
              request returns Warning and X-ClawMind-Api-Key-Expires-In-Days headers so
              SDKs can rotate before the credential lapses. The first crossing into
              the window writes one api-key.expiry_warned audit entry per key.
            </p>
          </div>
        </header>

        {loading && <SettingsCardSkeleton rows={2} />}

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
              <div className="rounded-lg border border-cm-border bg-cm-paper p-4">
                <div className="text-xs text-cm-muted">Active keys</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-cm-fg">
                  {counts.activeKeys}
                </div>
              </div>
              <div className="rounded-lg border border-cm-border bg-cm-paper p-4">
                <div className="text-xs text-cm-muted">With a TTL</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-cm-fg">
                  {counts.keysWithTtl}
                </div>
              </div>
              <div
                className={`rounded-lg border p-4 ${
                  counts.keysExpiringSoon > 0
                    ? 'border-cm-cite-line bg-cm-cite-bg'
                    : 'border-cm-border bg-cm-paper'
                }`}
              >
                <div className="text-xs text-cm-muted">Expiring soon</div>
                <div
                  className={`mt-1 text-2xl font-semibold tabular-nums ${
                    counts.keysExpiringSoon > 0 ? 'text-cm-cite' : 'text-cm-fg'
                  }`}
                >
                  {counts.keysExpiringSoon}
                </div>
              </div>
            </section>

            <form onSubmit={save} className="space-y-4">
              <section className="rounded-lg border border-cm-border bg-cm-paper p-5">
                <h2 className="text-sm font-semibold text-cm-fg">Warning window</h2>
                <p className="mt-1 text-xs text-cm-muted">
                  Days of advance notice surfaced to every authenticated API key
                  request. Zero disables warnings entirely.
                </p>
                <label className="mt-4 block">
                  <span className="text-xs font-medium text-cm-fg">Warn before (days)</span>
                  <input
                    type="number"
                    min={0}
                    max={limits.maxWarnDays}
                    value={warnDays}
                    onChange={(e) => setWarnDays(Number(e.target.value) || 0)}
                    className={INPUT_CLS}
                  />
                  <span
                    className={`mt-1 block text-[11px] ${
                      warnDays === 0 ? 'text-cm-cite' : 'text-cm-muted'
                    }`}
                  >
                    {warnDays === 0
                      ? 'no warning headers will be sent - SDKs get no advance notice'
                      : `flag keys expiring within ${warnDays} day${warnDays === 1 ? '' : 's'}`}
                  </span>
                </label>
                <p className="mt-3 text-[11px] text-cm-muted">
                  Last updated {fmtDate(policy.updatedAt)}
                  {policy.updatedBy ? ` by ${policy.updatedBy}` : ''}
                </p>
              </section>

              {actionError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] p-3 text-sm text-cm-danger"
                >
                  <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-md bg-cm-fg px-4 py-2 text-sm font-medium text-cm-bg hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? <Spinner /> : <IconKey className="h-4 w-4" />}
                  Save policy
                </button>
                {savedAt && (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] px-2.5 py-1 text-xs text-cm-success">
                    Saved {new Date(savedAt).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </form>

            <section className="rounded-lg border border-cm-border bg-cm-paper p-5">
              <h2 className="text-sm font-semibold text-cm-fg">Upcoming expirations</h2>
              <p className="mt-1 text-xs text-cm-muted">
                Active keys with a TTL inside the warning window, soonest first.
                Rotate from the keys page before they lapse.
              </p>
              {upcoming === null ? (
                <div className="mt-4 flex items-center gap-2 text-xs text-cm-muted">
                  <Spinner /> Loading
                </div>
              ) : upcoming.length === 0 ? (
                <div className="mt-4 rounded-md border border-dashed border-cm-border p-6 text-center text-xs text-cm-muted">
                  No keys are expiring inside the warning window.
                </div>
              ) : (
                <ul className="mt-4 divide-y divide-cm-border rounded-md border border-cm-border">
                  {upcoming.map((k) => (
                    <li
                      key={k.id}
                      className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-cm-fg">{k.label}</div>
                        <div className="text-[11px] text-cm-muted">
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
                        <div className="text-[11px] text-cm-muted">
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
