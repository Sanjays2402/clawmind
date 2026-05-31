'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, type MfaPolicy, type MfaPolicyLimits, ApiError } from '@/lib/api';
import {
  ErrorState,
  Spinner,
  IconArrowRight,
  IconCheck,
  IconRefresh,
  IconShield,
  IconWarning,
} from '@clawmind/ui';

function fmtDate(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

function fmtRemaining(graceEndsAt: number): string {
  const ms = graceEndsAt - Date.now();
  if (ms <= 0) return 'grace ended';
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days > 0) return `${days}d ${hours}h remaining`;
  return `${hours}h remaining`;
}

export default function MfaPolicyPage() {
  const [policy, setPolicy] = useState<MfaPolicy | null>(null);
  const [limits, setLimits] = useState<MfaPolicyLimits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [graceDays, setGraceDays] = useState<number>(7);
  const [saving, setSaving] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.mfaPolicyGet();
      setPolicy(res.policy);
      setLimits(res.limits);
      setGraceDays(res.policy.graceDays ?? res.limits.defaultGraceDays);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You need admin or owner access to view the MFA enforcement policy.');
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

  const enable = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setSaving(true);
    try {
      const next = await api.mfaPolicyEnable({ graceDays });
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

  const disable = async () => {
    if (
      !window.confirm(
        'Turn off workspace MFA enforcement? Members without MFA will be able to write again immediately.',
      )
    )
      return;
    setActionError(null);
    setDisabling(true);
    try {
      const next = await api.mfaPolicyDisable();
      setPolicy(next);
      setSavedAt(Date.now());
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'disable failed';
      setActionError(msg);
    } finally {
      setDisabling(false);
    }
  };

  const graceEndsAt =
    policy && policy.enforced && policy.enforcedAt
      ? policy.enforcedAt + policy.graceDays * 24 * 60 * 60 * 1000
      : null;

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconShield size={22} />
            <div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                MFA enforcement
              </h1>
              <p className="text-sm text-[var(--muted-fg)]">
                Require every member to enrol multi-factor auth before any
                mutating endpoint will accept their session. Owner-only, MFA
                required.
              </p>
            </div>
          </div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-sm text-[var(--muted-fg)] hover:text-[var(--fg)]"
          >
            Back to settings <IconArrowRight size={14} />
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--muted-fg)]">
            <Spinner /> Loading policy
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : !policy || !limits ? (
          <ErrorState message="Could not load the MFA policy." onRetry={() => void load()} />
        ) : (
          <div className="space-y-6">
            <section
              className={`rounded-lg border p-5 ${
                policy.enforced
                  ? 'border-emerald-500/50 bg-emerald-500/10'
                  : 'border-amber-500/50 bg-amber-500/10'
              }`}
            >
              <div className="flex items-start gap-3">
                {policy.enforced ? <IconCheck size={22} /> : <IconWarning size={22} />}
                <div className="flex-1 text-sm">
                  <div className="font-medium">
                    {policy.enforced
                      ? 'MFA enforcement is ON'
                      : 'MFA enforcement is OFF'}
                  </div>
                  <div className="mt-1 text-[var(--muted-fg)]">
                    {policy.enforced ? (
                      <>
                        Session users without confirmed MFA receive HTTP 412 on
                        mutating endpoints once the grace window elapses.
                        Enabled by{' '}
                        <span className="font-mono">{policy.enforcedBy ?? 'unknown'}</span>{' '}
                        at {fmtDate(policy.enforcedAt)}.
                        {graceEndsAt
                          ? ` Grace window ends ${fmtDate(graceEndsAt)} (${fmtRemaining(graceEndsAt)}).`
                          : ''}
                      </>
                    ) : (
                      <>
                        Per-user MFA is still available at{' '}
                        <Link href="/settings/mfa" className="underline">
                          /settings/mfa
                        </Link>
                        , but it is not required to write. Enable enforcement to
                        guarantee every member has a second factor.
                      </>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <form
              onSubmit={enable}
              className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--card)] p-5"
            >
              <div>
                <h2 className="text-base font-semibold">
                  {policy.enforced ? 'Update enforcement' : 'Turn enforcement on'}
                </h2>
                <p className="mt-1 text-sm text-[var(--muted-fg)]">
                  Audit-logged. Requires owner role and a recent MFA step-up.
                  API key callers are exempt; their security model is scope plus
                  per-key IP allowlist plus per-key rate limits.
                </p>
              </div>

              <div className="space-y-1">
                <label htmlFor="mp-grace" className="block text-sm font-medium">
                  Grace window (days)
                </label>
                <input
                  id="mp-grace"
                  type="number"
                  min={0}
                  max={limits.maxGraceDays}
                  value={graceDays}
                  onChange={(e) => setGraceDays(Number(e.target.value))}
                  className="w-32 rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none"
                />
                <p className="text-xs text-[var(--muted-fg)]">
                  Existing members get this many days to enrol after you turn
                  enforcement on. Set to 0 to require MFA immediately. Max{' '}
                  {limits.maxGraceDays}.
                </p>
              </div>

              {actionError ? (
                <div className="rounded border border-red-500/50 bg-red-500/10 p-3 text-sm">
                  {actionError}
                </div>
              ) : null}

              {savedAt ? (
                <div className="flex items-center gap-2 text-sm text-emerald-500">
                  <IconCheck size={16} /> Saved at {new Date(savedAt).toLocaleTimeString()}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded bg-[var(--fg)] px-4 py-2 text-sm font-medium text-[var(--bg)] disabled:opacity-50"
                >
                  {saving ? <Spinner /> : <IconShield size={16} />}
                  {policy.enforced ? 'Update grace window' : 'Enable MFA enforcement'}
                </button>
                {policy.enforced ? (
                  <button
                    type="button"
                    onClick={() => void disable()}
                    disabled={disabling}
                    className="inline-flex items-center gap-2 rounded border border-[var(--border)] px-4 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    {disabling ? <Spinner /> : <IconRefresh size={16} />}
                    Turn off enforcement
                  </button>
                ) : null}
              </div>
            </form>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5 text-sm text-[var(--muted-fg)]">
              <h3 className="mb-2 text-sm font-semibold text-[var(--fg)]">
                What happens when enforcement is on
              </h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  Session users without confirmed TOTP MFA see HTTP 412 with
                  <span className="font-mono"> mfa_enrollment_required</span> on
                  every mutating endpoint outside auth, MFA setup, sessions, and
                  GDPR self-export.
                </li>
                <li>
                  Reads stay open so users can still browse and export their data
                  during the grace window or after enforcement begins biting.
                </li>
                <li>
                  API keys are exempt. Use per-key scopes and the per-key IP
                  allowlist to lock automation down.
                </li>
                <li>
                  Every denial is written to the audit log as
                  <span className="font-mono"> mfa-policy.denied</span>.
                </li>
              </ul>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
