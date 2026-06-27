'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, type MfaPolicy, type MfaPolicyLimits, ApiError } from '@/lib/api';
import {
  ErrorState,
  Spinner,
  SettingsCardSkeleton,
  IconArrowRight,
  IconCheck,
  IconRefresh,
  IconShield,
  IconWarning,
} from '@clawmind/ui';

const INPUT_CLS =
  'w-32 rounded-lg border border-cm-border bg-cm-bg px-3 py-2 text-sm text-cm-fg outline-none placeholder:text-cm-faint focus:ring-2 focus:ring-cm-accent';

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
    <div className="min-h-screen bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="rounded-md border border-cm-border bg-cm-subtle p-2 text-cm-accent">
              <IconShield size={22} />
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                MFA enforcement
              </h1>
              <p className="text-sm text-cm-muted">
                Require every member to enrol multi-factor auth before any
                mutating endpoint will accept their session. Owner-only, MFA
                required.
              </p>
            </div>
          </div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-sm text-cm-muted hover:text-cm-fg"
          >
            Back to settings <IconArrowRight size={14} />
          </Link>
        </div>

        {loading ? (
          <SettingsCardSkeleton rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : !policy || !limits ? (
          <ErrorState message="Could not load the MFA policy." onRetry={() => void load()} />
        ) : (
          <div className="space-y-6">
            <section
              className={`rounded-xl border p-5 ${
                policy.enforced
                  ? 'border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)]'
                  : 'border-cm-cite-line bg-cm-cite-bg'
              }`}
            >
              <div className="flex items-start gap-3">
                {policy.enforced ? (
                  <IconCheck size={22} className="shrink-0 text-cm-success" />
                ) : (
                  <IconWarning size={22} className="shrink-0 text-cm-cite" />
                )}
                <div className="flex-1 text-sm">
                  <div className={`font-medium ${policy.enforced ? 'text-cm-success' : 'text-cm-cite'}`}>
                    {policy.enforced
                      ? 'MFA enforcement is ON'
                      : 'MFA enforcement is OFF'}
                  </div>
                  <div className="mt-1 text-cm-muted">
                    {policy.enforced ? (
                      <>
                        Session users without confirmed MFA receive HTTP 412 on
                        mutating endpoints once the grace window elapses.
                        Enabled by{' '}
                        <span className="cm-mono text-cm-fg">{policy.enforcedBy ?? 'unknown'}</span>{' '}
                        at {fmtDate(policy.enforcedAt)}.
                        {graceEndsAt
                          ? ` Grace window ends ${fmtDate(graceEndsAt)} (${fmtRemaining(graceEndsAt)}).`
                          : ''}
                      </>
                    ) : (
                      <>
                        Per-user MFA is still available at{' '}
                        <Link href="/settings/mfa" className="underline hover:text-cm-fg">
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
              className="space-y-4 rounded-xl border border-cm-border bg-cm-paper p-5"
            >
              <div>
                <h2 className="text-base font-semibold text-cm-fg">
                  {policy.enforced ? 'Update enforcement' : 'Turn enforcement on'}
                </h2>
                <p className="mt-1 text-sm text-cm-muted">
                  Audit-logged. Requires owner role and a recent MFA step-up.
                  API key callers are exempt; their security model is scope plus
                  per-key IP allowlist plus per-key rate limits.
                </p>
              </div>

              <div className="space-y-1">
                <label htmlFor="mp-grace" className="block text-sm font-medium text-cm-fg">
                  Grace window (days)
                </label>
                <input
                  id="mp-grace"
                  type="number"
                  min={0}
                  max={limits.maxGraceDays}
                  value={graceDays}
                  onChange={(e) => setGraceDays(Number(e.target.value))}
                  className={INPUT_CLS}
                />
                <p className="text-xs text-cm-muted">
                  Existing members get this many days to enrol after you turn
                  enforcement on. Set to 0 to require MFA immediately. Max{' '}
                  {limits.maxGraceDays}.
                </p>
              </div>

              {actionError ? (
                <div className="flex items-start gap-2 rounded-lg border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] px-3 py-2 text-sm text-cm-danger">
                  <IconWarning size={16} className="mt-0.5 shrink-0" />
                  <span>{actionError}</span>
                </div>
              ) : null}

              {savedAt ? (
                <div className="flex items-center gap-2 text-sm text-cm-success">
                  <IconCheck size={16} /> Saved at {new Date(savedAt).toLocaleTimeString()}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-cm-fg px-4 py-2 text-sm font-medium text-cm-bg transition hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? <Spinner /> : <IconShield size={16} />}
                  {policy.enforced ? 'Update grace window' : 'Enable MFA enforcement'}
                </button>
                {policy.enforced ? (
                  <button
                    type="button"
                    onClick={() => void disable()}
                    disabled={disabling}
                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] px-4 py-2 text-sm font-medium text-cm-danger transition hover:bg-[rgba(180,66,60,0.18)] disabled:opacity-50"
                  >
                    {disabling ? <Spinner /> : <IconRefresh size={16} />}
                    Turn off enforcement
                  </button>
                ) : null}
              </div>
            </form>

            <div className="rounded-xl border border-cm-border bg-cm-paper p-5 text-sm text-cm-muted">
              <h3 className="mb-2 text-sm font-semibold text-cm-fg">
                What happens when enforcement is on
              </h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  Session users without confirmed TOTP MFA see HTTP 412 with
                  <span className="cm-mono text-cm-fg"> mfa_enrollment_required</span> on
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
                  <span className="cm-mono text-cm-fg"> mfa-policy.denied</span>.
                </li>
              </ul>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
