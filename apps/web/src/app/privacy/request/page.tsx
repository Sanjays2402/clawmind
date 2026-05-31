'use client';

// Public-facing privacy request form.
//
// Anyone (workspace member or not) can submit a GDPR/CCPA data subject
// request without authenticating. We deliberately do not show any
// workspace-internal navigation here so the page can be linked from a
// privacy policy or DPA addendum without leaking branding chrome.
//
// Two-step flow: submit -> receive plaintext verifyToken -> follow
// /v1/dsr/verify/:id/:token to confirm control of the email. The
// confirmation URL is shown to the user so an operator running this
// form behind their own ESP can wire delivery; integrators that prefer
// to send the email server-side can ignore the displayed token and
// route it through their own templating.

import { useState } from 'react';
import { api, ApiError, type DsrKind } from '@/lib/api';
import { IconShield, IconCheck, IconWarning } from '@clawmind/ui';

const KINDS: { value: DsrKind; label: string; hint: string }[] = [
  { value: 'access', label: 'Access', hint: 'Get a copy of what we hold about you' },
  { value: 'erasure', label: 'Erasure', hint: 'Ask us to delete your personal data' },
  {
    value: 'rectification',
    label: 'Rectification',
    hint: 'Correct inaccurate personal data',
  },
  {
    value: 'portability',
    label: 'Portability',
    hint: 'Receive a machine-readable export',
  },
  {
    value: 'restriction',
    label: 'Restriction',
    hint: 'Limit how your data is processed',
  },
];

interface SubmitOk {
  id: string;
  verifyPath: string;
  verifyToken: string;
}

export default function PrivacyRequestPage() {
  const [email, setEmail] = useState('');
  const [kind, setKind] = useState<DsrKind>('access');
  const [details, setDetails] = useState('');
  // Honeypot. CSS-hidden, real users never fill it.
  const [website, setWebsite] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitOk | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = (await api.dsrSubmit({
        subjectEmail: email.trim(),
        kind,
        details: details.trim() || null,
        // Pass the honeypot so the server-side trap can fire. Real users
        // never see this field; bots fill it and get a soft 202.
        website: website || undefined,
      })) as SubmitOk;
      // Honeypot path returns id 'dsr_honeypot' with no real token.
      // Treat that as a soft success to avoid signalling the trap.
      setResult(r);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'submission failed',
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    const verifyUrl = result.verifyPath;
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center bg-[var(--bg)] px-4 py-10 text-[var(--fg)] sm:px-6">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8">
          <div className="mb-3 flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
            <IconCheck size={20} />
            <h1 className="text-lg font-semibold tracking-tight">Request received</h1>
          </div>
          <p className="text-sm text-[var(--muted)]">
            Reference <span className="font-mono text-[var(--fg)]">{result.id}</span>. To
            prove you control this email, open the verification link below. We respond
            within 30 days of verification.
          </p>
          {result.verifyToken && result.id !== 'dsr_honeypot' ? (
            <div className="mt-4 break-all rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs">
              {verifyUrl}
            </div>
          ) : null}
          <p className="mt-4 text-xs text-[var(--muted)]">
            Keep this link private. Anyone with it can confirm the request on your behalf.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center bg-[var(--bg)] px-4 py-10 text-[var(--fg)] sm:px-6">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8">
        <div className="mb-2 flex items-center gap-2 text-[var(--muted)]">
          <IconShield size={16} />
          <span className="text-xs uppercase tracking-wide">Privacy</span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          Request your data
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Submit a GDPR or CCPA request. You do not need an account. We verify your
          email before any action is taken.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="block text-xs font-medium text-[var(--muted)]">
              Your email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="kind" className="block text-xs font-medium text-[var(--muted)]">
              Type of request
            </label>
            <select
              id="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as DsrKind)}
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none"
            >
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}: {k.hint}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="details" className="block text-xs font-medium text-[var(--muted)]">
              Details (optional)
            </label>
            <textarea
              id="details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={4}
              maxLength={4000}
              className="mt-1 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none"
              placeholder="Anything that helps us locate your data."
            />
          </div>

          {/* Honeypot. Hidden from humans and screen readers. */}
          <div aria-hidden className="absolute left-[-9999px] top-[-9999px]" style={{ position: 'absolute', left: -9999 }}>
            <label htmlFor="website">Website</label>
            <input
              id="website"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>

          {error ? (
            <div className="flex items-start gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
              <IconWarning size={12} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting || !email}
            className="inline-flex w-full items-center justify-center rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit request'}
          </button>
        </form>
      </div>

      <p className="mt-4 text-center text-xs text-[var(--muted)]">
        We process requests within 30 days. False submissions may be reported.
      </p>
    </main>
  );
}
