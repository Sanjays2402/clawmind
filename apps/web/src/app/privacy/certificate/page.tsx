'use client';

// Public-facing erasure certificate viewer + verifier.
//
// A data subject (or their auditor / regulator) lands here with either
// the certificate id ClawMind handed them at fulfilment, or the
// original DSR id they used when they filed the request. We look up
// the signed receipt, show the immutable fields, and optionally
// confirm the holder's identity by replaying their email through the
// server-side constant-time check.
//
// This page intentionally exposes no workspace navigation chrome so it
// can be linked from a privacy policy or DPA addendum without leaking
// internal branding. We never display the plaintext email, only the
// sha256 fingerprint that already lives in the public receipt.

import { useState } from 'react';
import { api, ApiError, type ErasureCertificatePublic } from '@/lib/api';
import { IconShield, IconCheck, IconWarning } from '@clawmind/ui';

type LookupMode = 'certificate' | 'dsr';

interface Loaded {
  certificate: ErasureCertificatePublic;
  signatureValid: boolean;
}

interface VerifyResult {
  signatureValid: boolean;
  subjectMatches: boolean;
  verified: boolean;
  revokedAt: number | null;
}

function fmt(ts: number | null): string {
  if (!ts) return '';
  try {
    return new Date(ts).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  } catch {
    return String(ts);
  }
}

export default function ErasureCertificatePage() {
  const [mode, setMode] = useState<LookupMode>('certificate');
  const [lookupId, setLookupId] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const reset = () => {
    setLoaded(null);
    setLoadError(null);
    setVerifyResult(null);
    setVerifyError(null);
  };

  const onLoad = async (e: React.FormEvent) => {
    e.preventDefault();
    reset();
    const id = lookupId.trim();
    if (!id) return;
    setLoading(true);
    try {
      const r =
        mode === 'certificate'
          ? await api.erasureCertificateGet(id)
          : await api.erasureCertificateByDsr(id);
      setLoaded(r);
    } catch (err) {
      setLoadError(
        err instanceof ApiError
          ? err.status === 404
            ? 'No certificate found for that id'
            : err.message
          : err instanceof Error
            ? err.message
            : 'lookup failed',
      );
    } finally {
      setLoading(false);
    }
  };

  const onVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loaded) return;
    setVerifyError(null);
    setVerifyResult(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setVerifyError('Email is required');
      return;
    }
    setVerifying(true);
    try {
      const r = await api.erasureCertificateVerify(loaded.certificate.id, trimmed);
      setVerifyResult({
        signatureValid: r.signatureValid,
        subjectMatches: r.subjectMatches,
        verified: r.verified,
        revokedAt: r.revokedAt,
      });
    } catch (err) {
      setVerifyError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'verification failed',
      );
    } finally {
      setVerifying(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-[var(--bg)] px-4 py-10 text-[var(--fg)] sm:px-6">
      <header className="mb-8 flex items-start gap-3">
        <IconShield className="mt-1 h-6 w-6 text-[var(--accent)]" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Erasure certificate
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Look up and verify a GDPR Article 17 destruction receipt issued by this workspace.
          </p>
        </div>
      </header>

      <form
        onSubmit={onLoad}
        className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 sm:p-6"
      >
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="sr-only">Look up by</legend>
          {(['certificate', 'dsr'] as LookupMode[]).map((m) => (
            <label
              key={m}
              className={`cursor-pointer rounded-md border px-3 py-2 text-center text-sm transition ${
                mode === m
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--fg)]'
                  : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              <input
                type="radio"
                name="mode"
                value={m}
                checked={mode === m}
                onChange={() => {
                  setMode(m);
                  reset();
                }}
                className="sr-only"
              />
              {m === 'certificate' ? 'Certificate id' : 'Request id'}
            </label>
          ))}
        </fieldset>

        <label className="mt-4 block">
          <span className="text-sm font-medium">
            {mode === 'certificate' ? 'Certificate id' : 'Original DSR id'}
          </span>
          <input
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            placeholder={mode === 'certificate' ? 'ec_...' : 'dsr_...'}
            autoComplete="off"
            spellCheck={false}
            maxLength={80}
            required
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--accent)]"
          />
        </label>

        <button
          type="submit"
          disabled={loading || !lookupId.trim()}
          className="mt-4 w-full rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50 sm:w-auto"
        >
          {loading ? 'Loading' : 'Look up certificate'}
        </button>

        {loadError ? (
          <p
            role="alert"
            className="mt-4 flex items-center gap-2 text-sm text-[var(--danger,#dc2626)]"
          >
            <IconWarning className="h-4 w-4" />
            {loadError}
          </p>
        ) : null}
      </form>

      {loaded ? (
        <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base font-semibold">Receipt</h2>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                loaded.signatureValid
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'bg-red-500/15 text-red-700 dark:text-red-300'
              }`}
            >
              {loaded.signatureValid ? (
                <IconCheck className="h-3.5 w-3.5" />
              ) : (
                <IconWarning className="h-3.5 w-3.5" />
              )}
              {loaded.signatureValid ? 'Signature valid' : 'Signature invalid'}
            </span>
          </div>

          <dl className="mt-4 space-y-2 text-sm">
            <Field label="Certificate id" value={loaded.certificate.id} mono />
            <Field label="Request id" value={loaded.certificate.dsrId} mono />
            <Field label="Workspace" value={loaded.certificate.workspaceId} mono />
            <Field
              label="Subject fingerprint"
              value={loaded.certificate.subjectEmailFingerprint}
              mono
            />
            <Field label="Scope" value={loaded.certificate.scope || 'Not specified'} />
            <Field label="Fulfilled at" value={fmt(loaded.certificate.fulfilledAt)} />
            <Field label="Issued at" value={fmt(loaded.certificate.issuedAt)} />
            <Field
              label="Content fingerprint"
              value={loaded.certificate.contentFingerprint}
              mono
            />
            <Field label="Signature" value={loaded.certificate.signature} mono wrap />
            <Field label="Algorithm" value={loaded.certificate.algo} />
            {loaded.certificate.revokedAt ? (
              <>
                <Field label="Revoked at" value={fmt(loaded.certificate.revokedAt)} />
                <Field
                  label="Revocation reason"
                  value={loaded.certificate.revokedReason ?? ''}
                />
              </>
            ) : null}
          </dl>

          <form
            onSubmit={onVerify}
            className="mt-6 border-t border-[var(--border)] pt-5"
          >
            <h3 className="text-sm font-semibold">Verify holder</h3>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Confirm you are the subject of the original request by replaying the email
              you used. The address is compared against the stored fingerprint and never
              persisted.
            </p>
            <label className="mt-3 block">
              <span className="sr-only">Subject email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                maxLength={320}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              />
            </label>
            <button
              type="submit"
              disabled={verifying || !email.trim()}
              className="mt-3 rounded-md border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-[var(--bg)] disabled:opacity-50"
            >
              {verifying ? 'Verifying' : 'Verify'}
            </button>

            {verifyError ? (
              <p
                role="alert"
                className="mt-3 flex items-center gap-2 text-sm text-[var(--danger,#dc2626)]"
              >
                <IconWarning className="h-4 w-4" />
                {verifyError}
              </p>
            ) : null}

            {verifyResult ? (
              <div
                role="status"
                className={`mt-4 rounded-md border p-3 text-sm ${
                  verifyResult.verified
                    ? 'border-emerald-500/40 bg-emerald-500/10'
                    : 'border-amber-500/40 bg-amber-500/10'
                }`}
              >
                <div className="flex items-center gap-2 font-medium">
                  {verifyResult.verified ? (
                    <IconCheck className="h-4 w-4" />
                  ) : (
                    <IconWarning className="h-4 w-4" />
                  )}
                  {verifyResult.verified
                    ? 'Certificate verified'
                    : 'Certificate did not verify'}
                </div>
                <ul className="mt-2 space-y-1 text-xs text-[var(--muted)]">
                  <li>
                    Signature: {verifyResult.signatureValid ? 'valid' : 'invalid'}
                  </li>
                  <li>
                    Subject email matches fingerprint:{' '}
                    {verifyResult.subjectMatches ? 'yes' : 'no'}
                  </li>
                  {verifyResult.revokedAt ? (
                    <li>Revoked at: {fmt(verifyResult.revokedAt)}</li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </form>
        </section>
      ) : null}

      {!loaded && !loadError && !loading ? (
        <p className="mt-6 text-center text-sm text-[var(--muted)]">
          Paste the certificate id you were given or the original request id to retrieve
          the signed receipt.
        </p>
      ) : null}
    </main>
  );
}

function Field({
  label,
  value,
  mono,
  wrap,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wrap?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      <dt className="col-span-1 text-xs text-[var(--muted)]">{label}</dt>
      <dd
        className={`col-span-2 sm:col-span-3 ${mono ? 'font-mono text-xs' : 'text-sm'} ${
          wrap ? 'break-all' : 'truncate'
        }`}
      >
        {value || '-'}
      </dd>
    </div>
  );
}
