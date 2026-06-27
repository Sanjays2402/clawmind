'use client';

// /settings/mfa enrolls and manages TOTP multi-factor authentication.
// Enterprise procurement reviewers expect a clear, well-audited MFA flow
// before signing. This page does enrollment (show secret + recovery codes),
// confirmation (prove possession), step-up verification (for sensitive
// routes elsewhere), recovery-code regeneration, and full disable.
//
// Design notes:
//   * Secrets and recovery codes are shown ONCE on enrollment. We never
//     fetch them back from the server. If the user navigates away mid-
//     enrollment they must restart.
//   * QR rendering is intentionally not bundled: every modern authenticator
//     app accepts manual entry of the base32 secret, and a copy-to-clipboard
//     control plus the formatted secret is more reliable than a server-
//     rendered SVG that may not survive an air-gapped procurement demo.
//   * All mutating calls below already require an authenticated session.
//     /settings/mfa itself does not require MFA, by definition.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, ApiError } from '@/lib/api';
import {
  ErrorState,
  Spinner,
  IconShield,
  IconKey,
  IconCheck,
  IconWarning,
  IconArrowRight,
  IconRefresh,
  IconCopy,
  IconTrash,
} from '@clawmind/ui';

type Status = Awaited<ReturnType<typeof api.mfaStatus>>;
type Enrollment = Awaited<ReturnType<typeof api.mfaEnroll>>;

export default function MfaSettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [busy, setBusy] = useState(false);
  const [trustedReloadKey, setTrustedReloadKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await api.mfaStatus());
    } catch (err) {
      setError(err instanceof ApiError ? `Failed to load (${err.status})` : err instanceof Error ? err.message : 'failed');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-screen bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="rounded-md border border-cm-border bg-cm-subtle p-2 text-cm-accent">
              <IconShield size={22} />
            </span>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Multi-factor auth</h1>
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2.5 py-1.5 text-xs text-cm-muted hover:text-cm-fg"
          >
            <IconRefresh size={12} />
            Refresh
          </button>
        </div>

        <p className="mb-6 max-w-2xl text-sm text-cm-muted">
          Time-based one-time passcodes (TOTP, RFC 6238) protect sensitive
          actions like issuing API keys, deleting account data, editing the
          IP allowlist, revoking sessions, and running maintenance. Use any
          authenticator app such as 1Password, Authy, Google Authenticator,
          or your password manager.
        </p>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-cm-muted">
            <Spinner /> Loading
          </div>
        )}
        {!loading && error && <ErrorState message={error} onRetry={load} />}

        {!loading && !error && status && (
          <div className="grid gap-4">
            <StatusCard status={status} />
            {enrollment ? (
              <EnrollmentCard
                enrollment={enrollment}
                busy={busy}
                onConfirm={async (code) => {
                  setBusy(true);
                  setError(null);
                  try {
                    await api.mfaConfirm(code);
                    setEnrollment(null);
                    await load();
                  } catch (err) {
                    setError(err instanceof ApiError ? 'Code did not match. Try again.' : (err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
                onCancel={() => setEnrollment(null)}
              />
            ) : status.confirmed ? (
              <ManageCard
                status={status}
                busy={busy}
                onVerify={async (code, rememberDevice) => {
                  setBusy(true);
                  setError(null);
                  try {
                    await api.mfaVerify(code, { rememberDevice });
                    await load();
                    setTrustedReloadKey((k) => k + 1);
                  } catch (err) {
                    setError(err instanceof ApiError ? 'Code did not match.' : (err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
                onRegenerate={async (code) => {
                  setBusy(true);
                  setError(null);
                  try {
                    const out = await api.mfaRegenerateRecovery(code);
                    setEnrollment({ secret: '', otpauthUrl: '', recoveryCodes: out.recoveryCodes });
                    await load();
                  } catch (err) {
                    setError(err instanceof ApiError ? 'Code did not match.' : (err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
                onDisable={async (code) => {
                  setBusy(true);
                  setError(null);
                  try {
                    await api.mfaDisable(code);
                    await load();
                  } catch (err) {
                    setError(err instanceof ApiError ? 'Code did not match.' : (err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            ) : (
              <EnrollButton
                busy={busy}
                onStart={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const e = await api.mfaEnroll();
                    setEnrollment(e);
                  } catch (err) {
                    setError(err instanceof ApiError ? `Failed (${err.status})` : (err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            )}
            {status.confirmed && (
              <TrustedDevicesCard reloadKey={trustedReloadKey} />
            )}
            <BackLink />
          </div>
        )}
      </main>
    </div>
  );
}

function StatusCard({ status }: { status: Status }) {
  const state = !status.confirmed
    ? { label: 'Not enabled', Icon: IconWarning, tone: 'muted' as const }
    : { label: 'Enabled', Icon: IconCheck, tone: 'positive' as const };
  return (
    <section className="rounded-xl border border-cm-border bg-cm-paper p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Status</h2>
          <p className="mt-1 text-xs text-cm-muted">
            {status.confirmed
              ? `Step-up window ${Math.round(status.stepUpTtlSec / 60)} min. ${status.recoveryCodesRemaining} recovery codes remaining.`
              : 'Enable MFA to gate sensitive actions on a fresh code.'}
          </p>
        </div>
        <span
          className={
            'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ' +
            (state.tone === 'positive'
              ? 'border border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] text-[var(--cm-success)]'
              : 'border border-cm-cite-line bg-cm-cite-bg text-cm-cite')
          }
        >
          <state.Icon size={12} />
          {state.label}
        </span>
      </div>
      {status.confirmed && (
        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-cm-muted">Confirmed</dt>
            <dd className="mt-0.5 font-medium">
              {status.confirmedAt ? new Date(status.confirmedAt).toLocaleString() : 'unknown'}
            </dd>
          </div>
          <div>
            <dt className="text-cm-muted">Last verified</dt>
            <dd className="mt-0.5 font-medium">
              {status.sessionVerifiedAt
                ? new Date(status.sessionVerifiedAt).toLocaleString()
                : 'never this session'}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}

function EnrollButton({ busy, onStart }: { busy: boolean; onStart: () => void | Promise<void> }) {
  return (
    <section className="rounded-xl border border-cm-border bg-cm-paper p-4 sm:p-5">
      <h2 className="text-sm font-semibold">Enable MFA</h2>
      <p className="mt-1 text-xs text-cm-muted">
        We will generate a secret for your authenticator app and ten
        single-use recovery codes. Both are shown once.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={onStart}
        className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-cm-fg px-3 py-1.5 text-xs font-medium text-cm-bg hover:opacity-90 disabled:opacity-50"
      >
        <IconKey size={12} />
        {busy ? 'Generating' : 'Start enrollment'}
      </button>
    </section>
  );
}

function EnrollmentCard({
  enrollment,
  busy,
  onConfirm,
  onCancel,
}: {
  enrollment: Enrollment;
  busy: boolean;
  onConfirm: (code: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const hasSecret = enrollment.secret.length > 0;
  return (
    <section className="rounded-xl border border-cm-border bg-cm-paper p-4 sm:p-5">
      <h2 className="text-sm font-semibold">
        {hasSecret ? 'Pair your authenticator' : 'New recovery codes'}
      </h2>
      <p className="mt-1 text-xs text-cm-muted">
        {hasSecret
          ? 'Add this secret to your authenticator app, then enter the 6-digit code it shows.'
          : 'Store these recovery codes somewhere safe. They will not be shown again.'}
      </p>

      {hasSecret && (
        <div className="mt-4 grid gap-3">
          <Field label="Setup URI" value={enrollment.otpauthUrl} mono />
          <Field label="Secret" value={formatSecret(enrollment.secret)} mono />
        </div>
      )}

      <div className="mt-4">
        <h3 className="text-xs font-semibold text-cm-muted">Recovery codes</h3>
        <ul className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-2">
          {enrollment.recoveryCodes.map((c) => (
            <li
              key={c}
              className="rounded-md border border-cm-border bg-cm-bg px-2 py-1.5 font-mono text-xs tracking-tight"
            >
              {c}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(enrollment.recoveryCodes.join('\n'))}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2 py-1 text-xs text-cm-muted hover:text-cm-fg"
        >
          <IconCopy size={12} />
          Copy all
        </button>
      </div>

      {hasSecret && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && /^\d{6}$/.test(code)) void onConfirm(code);
          }}
          className="mt-5 flex flex-wrap items-center gap-2"
        >
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            className="w-28 rounded-md border border-cm-border bg-cm-bg px-2 py-1.5 text-center font-mono text-sm tabular-nums"
            aria-label="Six-digit code"
          />
          <button
            type="submit"
            disabled={busy || !/^\d{6}$/.test(code)}
            className="inline-flex items-center gap-1.5 rounded-md bg-cm-fg px-3 py-1.5 text-xs font-medium text-cm-bg hover:opacity-90 disabled:opacity-50"
          >
            <IconCheck size={12} />
            Confirm
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-cm-border px-2.5 py-1.5 text-xs text-cm-muted hover:text-cm-fg"
          >
            Cancel
          </button>
        </form>
      )}
      {!hasSecret && (
        <div className="mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-cm-border px-2.5 py-1.5 text-xs text-cm-muted hover:text-cm-fg"
          >
            Done
          </button>
        </div>
      )}
    </section>
  );
}

function ManageCard({
  status,
  busy,
  onVerify,
  onRegenerate,
  onDisable,
}: {
  status: Status;
  busy: boolean;
  onVerify: (code: string, rememberDevice: boolean) => Promise<void>;
  onRegenerate: (code: string) => Promise<void>;
  onDisable: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(false);
  const valid = /^\d{6}$/.test(code) || /^[A-Za-z0-9-]{10,12}$/.test(code);
  return (
    <section className="rounded-xl border border-cm-border bg-cm-paper p-4 sm:p-5">
      <h2 className="text-sm font-semibold">Manage</h2>
      <p className="mt-1 text-xs text-cm-muted">
        Enter a current code or a recovery code to step up this session,
        regenerate recovery codes, or disable MFA.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          inputMode="text"
          autoComplete="one-time-code"
          maxLength={12}
          value={code}
          onChange={(e) => setCode(e.target.value.trim())}
          placeholder="123456 or recovery"
          className="w-44 rounded-md border border-cm-border bg-cm-bg px-2 py-1.5 font-mono text-sm"
          aria-label="Code"
        />
        <button
          type="button"
          disabled={busy || !valid}
          onClick={() => onVerify(code, remember).then(() => setCode(''))}
          className="inline-flex items-center gap-1.5 rounded-md bg-cm-fg px-3 py-1.5 text-xs font-medium text-cm-bg hover:opacity-90 disabled:opacity-50"
        >
          <IconCheck size={12} />
          Verify
        </button>
        <button
          type="button"
          disabled={busy || !valid}
          onClick={() => onRegenerate(code).then(() => setCode(''))}
          className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2.5 py-1.5 text-xs text-cm-muted hover:text-cm-fg disabled:opacity-50"
        >
          <IconRefresh size={12} />
          New recovery codes
        </button>
        <button
          type="button"
          disabled={busy || !valid}
          onClick={() => {
            if (confirm('Disable MFA for this account?')) void onDisable(code).then(() => setCode(''));
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--cm-danger)] px-2.5 py-1.5 text-xs text-[var(--cm-danger)] transition hover:bg-[rgba(180,66,60,0.10)] disabled:opacity-50"
        >
          <IconTrash size={12} />
          Disable MFA
        </button>
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs text-cm-muted">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-cm-border accent-cm-accent"
        />
        Remember this device for 14 days (skip code on next sensitive action)
      </label>
      <div className="mt-4 text-xs text-cm-muted">
        Step-up window: {Math.round(status.stepUpTtlSec / 60)} minutes after a successful verify.
        {status.sessionStepUpActive ? ' This session is currently stepped up.' : ' This session is not stepped up.'}
      </div>
    </section>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-cm-muted">{label}</span>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(value)}
          className="inline-flex items-center gap-1 rounded-md border border-cm-border px-1.5 py-0.5 text-[10px] text-cm-muted hover:text-cm-fg"
          aria-label={`Copy ${label}`}
        >
          <IconCopy size={10} />
          Copy
        </button>
      </div>
      <div
        className={
          'mt-1 break-all rounded-md border border-cm-border bg-cm-bg px-2 py-1.5 text-xs ' +
          (mono ? 'font-mono' : '')
        }
      >
        {value}
      </div>
    </div>
  );
}

function formatSecret(secret: string): string {
  // Group base32 in fours for legibility when typed manually.
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

function TrustedDevicesCard({ reloadKey }: { reloadKey: number }) {
  type Device = Awaited<ReturnType<typeof api.mfaTrustedDevices>>['devices'][number];
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.mfaTrustedDevices();
      setDevices(r.devices);
      setCurrentId(r.currentDeviceId);
    } catch (e) {
      setErr(e instanceof ApiError ? `Failed (${e.status})` : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  return (
    <section className="rounded-xl border border-cm-border bg-cm-paper p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Trusted devices</h2>
          <p className="mt-1 text-xs text-cm-muted">
            Browsers that skip the code prompt for the trust window. Revoking a device immediately requires a fresh code on the next sensitive action.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2 py-1 text-[11px] text-cm-muted hover:text-cm-fg"
          >
            <IconRefresh size={11} />
            Refresh
          </button>
          <button
            type="button"
            disabled={!devices || devices.length === 0 || busy !== null}
            onClick={async () => {
              if (!confirm('Revoke all trusted devices? Every browser will need a fresh code on the next sensitive action.')) return;
              setBusy('all');
              try {
                await api.mfaRevokeAllTrustedDevices();
                await load();
              } catch (e) {
                setErr(e instanceof ApiError ? (e.status === 401 ? 'Step up with a code first.' : `Failed (${e.status})`) : (e as Error).message);
              } finally {
                setBusy(null);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--cm-danger)] px-2 py-1 text-[11px] text-[var(--cm-danger)] transition hover:bg-[rgba(180,66,60,0.10)] disabled:opacity-50"
          >
            <IconTrash size={11} />
            Revoke all
          </button>
        </div>
      </div>

      {loading && (
        <div className="mt-4 flex items-center gap-2 text-xs text-cm-muted">
          <Spinner /> Loading
        </div>
      )}
      {!loading && err && <div className="mt-4 text-xs text-[var(--cm-danger)]">{err}</div>}
      {!loading && !err && devices && devices.length === 0 && (
        <div className="mt-4 rounded-md border border-dashed border-cm-border p-4 text-center text-xs text-cm-muted">
          No trusted devices yet. Tick &ldquo;Remember this device&rdquo; during a verify to add this browser.
        </div>
      )}
      {!loading && !err && devices && devices.length > 0 && (
        <ul className="mt-4 divide-y divide-cm-border overflow-hidden rounded-md border border-cm-border">
          {devices.map((d) => {
            const isCurrent = d.id === currentId;
            return (
              <li key={d.id} className="flex flex-col gap-2 p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <IconShield size={12} />
                    <span className="font-medium">{d.label}</span>
                    {isCurrent && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-cm-accent-line bg-cm-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-cm-accent">
                        This browser
                      </span>
                    )}
                  </div>
                  <div className="mt-1 truncate text-[11px] text-cm-muted">
                    {d.ip || 'unknown ip'} · last seen {formatRelative(d.lastSeenAt)} · expires {formatRelative(d.expiresAt)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={async () => {
                      if (!confirm(isCurrent ? 'Revoke this browser? You will need a code on the next sensitive action.' : `Revoke ${d.label}?`)) return;
                      setBusy(d.id);
                      try {
                        await api.mfaRevokeTrustedDevice(d.id);
                        await load();
                      } catch (e) {
                        setErr(e instanceof ApiError ? (e.status === 401 ? 'Step up with a code first.' : `Failed (${e.status})`) : (e as Error).message);
                      } finally {
                        setBusy(null);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2 py-1 text-[11px] text-cm-muted hover:text-cm-fg disabled:opacity-50"
                  >
                    <IconTrash size={11} />
                    Revoke
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function formatRelative(ts: number): string {
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const units: Array<[number, string]> = [
    [86400_000 * 30, 'mo'],
    [86400_000, 'd'],
    [3600_000, 'h'],
    [60_000, 'm'],
  ];
  for (const [ms, label] of units) {
    if (abs >= ms) {
      const n = Math.round(diff / ms);
      return n >= 0 ? `in ${n}${label}` : `${-n}${label} ago`;
    }
  }
  return diff >= 0 ? 'in <1m' : '<1m ago';
}

function BackLink() {
  return (
    <Link
      href="/settings"
      className="inline-flex items-center gap-1.5 text-xs text-cm-muted hover:text-cm-fg"
    >
      <IconArrowRight size={12} className="rotate-180" />
      Back to settings
    </Link>
  );
}
