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
    <div className="min-h-screen bg-[var(--bg)]">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconShield size={22} />
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Multi-factor auth</h1>
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            <IconRefresh size={12} />
            Refresh
          </button>
        </div>

        <p className="mb-6 max-w-2xl text-sm text-[var(--fg-muted)]">
          Time-based one-time passcodes (TOTP, RFC 6238) protect sensitive
          actions like issuing API keys, deleting account data, editing the
          IP allowlist, revoking sessions, and running maintenance. Use any
          authenticator app such as 1Password, Authy, Google Authenticator,
          or your password manager.
        </p>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-[var(--fg-muted)]">
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
                onVerify={async (code) => {
                  setBusy(true);
                  setError(null);
                  try {
                    await api.mfaVerify(code);
                    await load();
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
    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Status</h2>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">
            {status.confirmed
              ? `Step-up window ${Math.round(status.stepUpTtlSec / 60)} min. ${status.recoveryCodesRemaining} recovery codes remaining.`
              : 'Enable MFA to gate sensitive actions on a fresh code.'}
          </p>
        </div>
        <span
          className={
            'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ' +
            (state.tone === 'positive'
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-amber-500/10 text-amber-700 dark:text-amber-400')
          }
        >
          <state.Icon size={12} />
          {state.label}
        </span>
      </div>
      {status.confirmed && (
        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-[var(--fg-muted)]">Confirmed</dt>
            <dd className="mt-0.5 font-medium">
              {status.confirmedAt ? new Date(status.confirmedAt).toLocaleString() : 'unknown'}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--fg-muted)]">Last verified</dt>
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
    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-4 sm:p-5">
      <h2 className="text-sm font-semibold">Enable MFA</h2>
      <p className="mt-1 text-xs text-[var(--fg-muted)]">
        We will generate a secret for your authenticator app and ten
        single-use recovery codes. Both are shown once.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={onStart}
        className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-[var(--fg)] px-3 py-1.5 text-xs font-medium text-[var(--bg)] hover:opacity-90 disabled:opacity-50"
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
    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-4 sm:p-5">
      <h2 className="text-sm font-semibold">
        {hasSecret ? 'Pair your authenticator' : 'New recovery codes'}
      </h2>
      <p className="mt-1 text-xs text-[var(--fg-muted)]">
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
        <h3 className="text-xs font-semibold text-[var(--fg-muted)]">Recovery codes</h3>
        <ul className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-2">
          {enrollment.recoveryCodes.map((c) => (
            <li
              key={c}
              className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 font-mono text-xs tracking-tight"
            >
              {c}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(enrollment.recoveryCodes.join('\n'))}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]"
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
            className="w-28 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-center font-mono text-sm tabular-nums"
            aria-label="Six-digit code"
          />
          <button
            type="submit"
            disabled={busy || !/^\d{6}$/.test(code)}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--fg)] px-3 py-1.5 text-xs font-medium text-[var(--bg)] hover:opacity-90 disabled:opacity-50"
          >
            <IconCheck size={12} />
            Confirm
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]"
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
            className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]"
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
  onVerify: (code: string) => Promise<void>;
  onRegenerate: (code: string) => Promise<void>;
  onDisable: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const valid = /^\d{6}$/.test(code) || /^[A-Za-z0-9-]{10,12}$/.test(code);
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-4 sm:p-5">
      <h2 className="text-sm font-semibold">Manage</h2>
      <p className="mt-1 text-xs text-[var(--fg-muted)]">
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
          className="w-44 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 font-mono text-sm"
          aria-label="Code"
        />
        <button
          type="button"
          disabled={busy || !valid}
          onClick={() => onVerify(code).then(() => setCode(''))}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--fg)] px-3 py-1.5 text-xs font-medium text-[var(--bg)] hover:opacity-90 disabled:opacity-50"
        >
          <IconCheck size={12} />
          Verify
        </button>
        <button
          type="button"
          disabled={busy || !valid}
          onClick={() => onRegenerate(code).then(() => setCode(''))}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)] disabled:opacity-50"
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
          className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
        >
          <IconTrash size={12} />
          Disable MFA
        </button>
      </div>
      <div className="mt-4 text-xs text-[var(--fg-muted)]">
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
        <span className="text-xs font-semibold text-[var(--fg-muted)]">{label}</span>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(value)}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
          aria-label={`Copy ${label}`}
        >
          <IconCopy size={10} />
          Copy
        </button>
      </div>
      <div
        className={
          'mt-1 break-all rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs ' +
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

function BackLink() {
  return (
    <Link
      href="/settings"
      className="inline-flex items-center gap-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]"
    >
      <IconArrowRight size={12} className="rotate-180" />
      Back to settings
    </Link>
  );
}
