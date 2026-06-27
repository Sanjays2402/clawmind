'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  type SessionPolicy,
  type SessionPolicyLimits,
  ApiError,
} from '@/lib/api';
import {
  ErrorState,
  Spinner,
  SettingsCardSkeleton,
  IconArrowRight,
  IconCheck,
  IconClockCountdown,
  IconRefresh,
  IconShield,
  IconWarning,
} from '@clawmind/ui';

// Shared input chrome so every numeric field reads as one control on the
// paper surface: cm-bg fill, faint placeholder, accent focus ring.
const INPUT_CLS =
  'w-full rounded-lg border border-cm-border bg-cm-bg px-3 py-2 font-mono text-sm text-cm-fg outline-none placeholder:text-cm-faint focus:ring-2 focus:ring-cm-accent';

function fmtMinutes(min: number): string {
  if (min <= 0) return 'unset';
  if (min < 60) return `${min} min`;
  const h = min / 60;
  if (h < 24) return h % 1 === 0 ? `${h} h` : `${h.toFixed(1)} h`;
  const d = h / 24;
  return d % 1 === 0 ? `${d} d` : `${d.toFixed(1)} d`;
}

function fmtDate(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

export default function SessionPolicyPage() {
  const [policy, setPolicy] = useState<SessionPolicy | null>(null);
  const [limits, setLimits] = useState<SessionPolicyLimits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [lifetime, setLifetime] = useState<number>(0);
  const [idle, setIdle] = useState<number>(0);
  const [concurrent, setConcurrent] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.sessionPolicyGet();
      setPolicy(res.policy);
      setLimits(res.limits);
      setLifetime(res.policy.maxLifetimeMinutes);
      setIdle(res.policy.idleTimeoutMinutes);
      setConcurrent(res.policy.maxConcurrentSessions ?? 0);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You need admin or owner access to view the session policy.');
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
      const next = await api.sessionPolicySet({
        maxLifetimeMinutes: lifetime,
        idleTimeoutMinutes: idle,
        maxConcurrentSessions: concurrent,
      });
      setPolicy(next);
      setSavedAt(Date.now());
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

  const clearAll = async () => {
    if (
      !window.confirm(
        'Turn off both lifetime and idle caps? Sessions will only expire when the user signs out.',
      )
    )
      return;
    setActionError(null);
    setSaving(true);
    try {
      const next = await api.sessionPolicySet({ maxLifetimeMinutes: 0, idleTimeoutMinutes: 0, maxConcurrentSessions: 0 });
      setPolicy(next);
      setLifetime(0);
      setIdle(0);
      setConcurrent(0);
      setSavedAt(Date.now());
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

  const applyPreset = (lifeMin: number, idleMin: number) => {
    setLifetime(lifeMin);
    setIdle(idleMin);
  };

  // A session policy that caps neither lifetime nor idle leaves sessions
  // alive until the user manually signs out. That is a real posture gap, so
  // the live banner reads through the brand inks: any cap active -> success
  // wash, no cap at all -> cite-gold caution.
  const hasCap =
    policy != null &&
    (policy.maxLifetimeMinutes > 0 ||
      policy.idleTimeoutMinutes > 0 ||
      policy.maxConcurrentSessions > 0);

  return (
    <div className="min-h-screen bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="mb-8 flex items-center gap-3">
          <span className="rounded-md border border-cm-border bg-cm-subtle p-2 text-cm-accent">
            <IconShield size={22} />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Session lifetime</h1>
            <p className="text-sm text-cm-muted">
              Cap how long a signed-in browser session lives and how long it can sit idle.
            </p>
          </div>
        </div>

        <div className="mb-4 text-sm">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-cm-muted hover:text-cm-fg"
          >
            <IconArrowRight size={14} className="rotate-180" /> Back to settings
          </Link>
        </div>

        {loading ? (
          <SettingsCardSkeleton rows={4} />
        ) : error ? (
          <ErrorState title="Cannot load policy" message={error} onRetry={load} />
        ) : policy && limits ? (
          <div className="space-y-6">
            <section
              className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${
                hasCap
                  ? 'border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)]'
                  : 'border-cm-cite-line bg-cm-cite-bg'
              }`}
            >
              {hasCap ? (
                <IconCheck size={18} className="mt-0.5 shrink-0 text-cm-success" />
              ) : (
                <IconWarning size={18} className="mt-0.5 shrink-0 text-cm-cite" />
              )}
              <div className={hasCap ? 'text-cm-success' : 'text-cm-cite'}>
                {hasCap ? (
                  <>
                    <span className="font-medium">Session caps are active.</span>{' '}
                    Sessions expire automatically once they exceed the policy below.
                  </>
                ) : (
                  <>
                    <span className="font-medium">No session caps are set.</span>{' '}
                    Signed-in sessions live until the user manually signs out. Set a
                    lifetime or idle cap below to bound exposure.
                  </>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-cm-border bg-cm-paper p-5">
              <h2 className="mb-3 flex items-center gap-2 text-base font-medium text-cm-fg">
                <IconClockCountdown size={18} />
                Current policy
              </h2>
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-cm-muted">Max lifetime</dt>
                  <dd className="font-medium text-cm-fg">{fmtMinutes(policy.maxLifetimeMinutes)}</dd>
                </div>
                <div>
                  <dt className="text-cm-muted">Idle timeout</dt>
                  <dd className="font-medium text-cm-fg">{fmtMinutes(policy.idleTimeoutMinutes)}</dd>
                </div>
                <div>
                  <dt className="text-cm-muted">Max concurrent sessions per user</dt>
                  <dd className="font-medium text-cm-fg">{policy.maxConcurrentSessions > 0 ? policy.maxConcurrentSessions : 'unset'}</dd>
                </div>
                <div>
                  <dt className="text-cm-muted">Last updated</dt>
                  <dd className="text-cm-fg">{fmtDate(policy.updatedAt)}</dd>
                </div>
                <div>
                  <dt className="text-cm-muted">Updated by</dt>
                  <dd className="truncate text-cm-fg">{policy.updatedBy ?? 'never set'}</dd>
                </div>
              </dl>
            </section>

            <form
              onSubmit={save}
              className="space-y-5 rounded-xl border border-cm-border bg-cm-paper p-5"
            >
              <h2 className="text-base font-medium text-cm-fg">Update policy</h2>

              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => applyPreset(limits.defaultLifetimeMinutes, limits.defaultIdleMinutes)}
                  className="rounded-md border border-cm-border px-3 py-1 text-cm-fg hover:bg-cm-subtle"
                >
                  Default (7 d / 8 h)
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset(60 * 24, 60)}
                  className="rounded-md border border-cm-border px-3 py-1 text-cm-fg hover:bg-cm-subtle"
                >
                  Strict (1 d / 1 h)
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset(60 * 12, 30)}
                  className="rounded-md border border-cm-border px-3 py-1 text-cm-fg hover:bg-cm-subtle"
                >
                  High security (12 h / 30 min)
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-1 block text-cm-muted">
                    Max lifetime (minutes, 0 = unset)
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={limits.maxLifetimeMinutes}
                    step={1}
                    value={lifetime}
                    onChange={(e) => setLifetime(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                    className={INPUT_CLS}
                  />
                  <span className="mt-1 block text-xs text-cm-muted">
                    Resolves to {fmtMinutes(lifetime)}. Max {fmtMinutes(limits.maxLifetimeMinutes)}.
                  </span>
                </label>

                <label className="text-sm">
                  <span className="mb-1 block text-cm-muted">
                    Idle timeout (minutes, 0 = unset)
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={limits.maxIdleMinutes}
                    step={1}
                    value={idle}
                    onChange={(e) => setIdle(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                    className={INPUT_CLS}
                  />
                  <span className="mt-1 block text-xs text-cm-muted">
                    Resolves to {fmtMinutes(idle)}. Max {fmtMinutes(limits.maxIdleMinutes)}.
                  </span>
                </label>

                <label className="text-sm sm:col-span-2">
                  <span className="mb-1 block text-cm-muted">
                    Max concurrent sessions per user (0 = unset)
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={limits.maxConcurrentSessions ?? 50}
                    step={1}
                    value={concurrent}
                    onChange={(e) => setConcurrent(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                    className={INPUT_CLS}
                  />
                  <span className="mt-1 block text-xs text-cm-muted">
                    When a user signs in past this cap, the oldest active session is signed out and an audit entry is written. Max {limits.maxConcurrentSessions ?? 50}.
                  </span>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-cm-border pt-4">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-cm-fg px-4 py-2 text-sm font-medium text-cm-bg transition hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? <Spinner /> : <IconCheck size={16} />}
                  Save policy
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg border border-cm-border px-4 py-2 text-sm text-cm-fg hover:bg-cm-subtle disabled:opacity-50"
                >
                  <IconRefresh size={16} />
                  Turn both off
                </button>
                {savedAt && !actionError ? (
                  <span className="inline-flex items-center gap-1 text-xs text-cm-success">
                    <IconCheck size={12} />
                    Saved {fmtDate(savedAt)}
                  </span>
                ) : null}
              </div>

              {actionError ? (
                <div className="flex items-start gap-2 rounded-lg border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] px-3 py-2 text-sm text-cm-danger">
                  <IconWarning size={16} className="mt-0.5 shrink-0" />
                  <span>{actionError}</span>
                </div>
              ) : null}

              <p className="text-xs text-cm-muted">
                Owner role plus a recent MFA step-up is required to change this policy. Sessions
                that already exceed the new caps are revoked on their next request. API key callers
                are not affected; rotate or revoke keys from the API keys page instead.
              </p>
            </form>
          </div>
        ) : null}
      </main>
    </div>
  );
}
