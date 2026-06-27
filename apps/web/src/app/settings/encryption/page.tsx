'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, type EncryptionStatus, ApiError } from '@/lib/api';
import {
  ErrorState,
  Spinner,
  SettingsCardSkeleton,
  IconArrowRight,
  IconCheck,
  IconKey,
  IconRefresh,
  IconShield,
  IconWarning,
} from '@clawmind/ui';

function fmtDate(ts: number | null | undefined): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

export default function EncryptionPage() {
  const [status, setStatus] = useState<EncryptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [kek, setKek] = useState('');
  const [confirmKek, setConfirmKek] = useState('');
  const [busy, setBusy] = useState<'upload' | 'remove' | 'rotate' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await api.encryptionGet();
      setStatus(s);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You do not have permission to view encryption settings.');
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

  const apiMsg = (err: unknown, fallback: string): string => {
    if (err instanceof ApiError) return `${err.status}: ${err.message}`;
    if (err instanceof Error) return err.message;
    return fallback;
  };

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setNotice(null);
    setBusy('upload');
    try {
      const next = await api.encryptionUploadKek(kek.trim());
      setStatus(next);
      setKek('');
      setNotice(
        'Customer KEK active. Store this key yourself. ClawMind never persists it; losing it locks the workspace out of encrypted data.',
      );
    } catch (err) {
      setActionError(apiMsg(err, 'upload failed'));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirmKek.trim()) {
      setActionError('Provide the active customer KEK to confirm removal.');
      return;
    }
    if (
      !window.confirm(
        'Remove the customer-managed KEK and rewrap all data under the internal KEK?',
      )
    ) {
      return;
    }
    setActionError(null);
    setNotice(null);
    setBusy('remove');
    try {
      const next = await api.encryptionRemoveKek(confirmKek.trim());
      setStatus(next);
      setConfirmKek('');
      setNotice('Customer KEK removed. Data is now wrapped under the internal KEK.');
    } catch (err) {
      setActionError(apiMsg(err, 'remove failed'));
    } finally {
      setBusy(null);
    }
  };

  const rotate = async () => {
    if (!window.confirm('Rotate the workspace data encryption key now?')) return;
    setActionError(null);
    setNotice(null);
    setBusy('rotate');
    try {
      const supplied = status?.kekKind === 'customer' ? confirmKek.trim() : undefined;
      if (status?.kekKind === 'customer' && !supplied) {
        setActionError('Provide the active customer KEK to authorise rotation.');
        setBusy(null);
        return;
      }
      const next = await api.encryptionRotate(supplied);
      setStatus(next);
      setNotice(`Rotated. New active key id: ${next.activeKeyId}`);
    } catch (err) {
      setActionError(apiMsg(err, 'rotate failed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="rounded-md border border-cm-border bg-cm-subtle p-2 text-cm-accent">
              <IconKey size={22} />
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                Encryption keys
              </h1>
              <p className="text-sm text-cm-muted">
                Manage the workspace key encryption key (KEK) and rotate the
                data encryption key (DEK). Owner-only, MFA required.
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
          <SettingsCardSkeleton rows={3} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : !status ? (
          <ErrorState message="Could not load encryption status." onRetry={() => void load()} />
        ) : (
          <div className="space-y-6">
            <section
              className={`rounded-lg border p-5 ${
                status.kekKind === 'customer'
                  ? 'border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)]'
                  : 'border-cm-border bg-cm-paper'
              }`}
            >
              <div className="flex items-start gap-3">
                <span className={status.kekKind === 'customer' ? 'text-[var(--cm-success)]' : 'text-cm-accent'}>
                  {status.kekKind === 'customer' ? (
                    <IconShield size={22} />
                  ) : (
                    <IconCheck size={22} />
                  )}
                </span>
                <div className="flex-1 text-sm">
                  <div className="font-medium">
                    {status.kekKind === 'customer'
                      ? 'Customer-managed KEK is active'
                      : 'Internal KEK in force'}
                  </div>
                  <div className="mt-1 text-cm-muted">
                    {status.kekKind === 'customer'
                      ? 'Your supplied 32-byte key wraps the workspace DEK. The plaintext KEK is held only in memory at upload time and never persisted.'
                      : 'Data is encrypted with a workspace-local DEK wrapped by the server master key. Upload a customer KEK below to take control.'}
                  </div>
                  <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="text-cm-muted">KEK fingerprint</dt>
                      <dd className="font-mono">{status.kekFingerprintShort}...</dd>
                    </div>
                    <div>
                      <dt className="text-cm-muted">Active key id</dt>
                      <dd className="font-mono">{status.activeKeyId}</dd>
                    </div>
                    <div>
                      <dt className="text-cm-muted">Active since</dt>
                      <dd>{fmtDate(status.activeKeyCreatedAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-cm-muted">Archived keys</dt>
                      <dd>{status.archivedKeyCount}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </section>

            {notice ? (
              <div className="flex items-start gap-2 rounded-lg border border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] p-3 text-sm text-[var(--cm-success)]">
                <IconCheck size={16} />
                <span>{notice}</span>
              </div>
            ) : null}
            {actionError ? (
              <div className="flex items-start gap-2 rounded-lg border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] p-3 text-sm text-[var(--cm-danger)]">
                <IconWarning size={16} />
                <span>{actionError}</span>
              </div>
            ) : null}

            {status.kekKind === 'internal' ? (
              <form
                onSubmit={upload}
                className="space-y-4 rounded-lg border border-cm-border bg-cm-paper p-5"
              >
                <div>
                  <h2 className="text-base font-semibold">Upload a customer KEK</h2>
                  <p className="mt-1 text-sm text-cm-muted">
                    Provide a 32-byte AES-256 key as base64. The active DEK is
                    rewrapped under your key; we never write the plaintext KEK
                    to disk. Audit logged.
                  </p>
                </div>
                <div className="space-y-1">
                  <label htmlFor="enc-kek" className="block text-sm font-medium">
                    KEK (base64, 32 bytes)
                  </label>
                  <input
                    id="enc-kek"
                    type="password"
                    autoComplete="off"
                    value={kek}
                    onChange={(e) => setKek(e.target.value)}
                    placeholder="base64 of 32 random bytes"
                    className="w-full rounded-md border border-cm-border bg-cm-bg px-3 py-2 font-mono text-sm placeholder:text-cm-faint focus:outline-none focus:ring-2 focus:ring-cm-accent"
                    required
                  />
                  <p className="text-xs text-cm-muted">
                    Generate locally, for example:{' '}
                    <code className="font-mono">openssl rand -base64 32</code>
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={busy === 'upload' || kek.trim().length === 0}
                  className="inline-flex items-center gap-1.5 rounded-md bg-cm-fg px-3 py-1.5 text-sm font-medium text-cm-bg transition hover:opacity-90 disabled:opacity-50"
                >
                  {busy === 'upload' ? <Spinner /> : <IconShield size={14} />}
                  Upload customer KEK
                </button>
              </form>
            ) : (
              <section className="space-y-4 rounded-lg border border-cm-border bg-cm-paper p-5">
                <div>
                  <h2 className="text-base font-semibold">Active customer KEK</h2>
                  <p className="mt-1 text-sm text-cm-muted">
                    Supply the current KEK to authorise destructive actions
                    (rotation, removal). Each action is audit logged.
                  </p>
                </div>
                <div className="space-y-1">
                  <label htmlFor="enc-kek-confirm" className="block text-sm font-medium">
                    Current KEK (base64)
                  </label>
                  <input
                    id="enc-kek-confirm"
                    type="password"
                    autoComplete="off"
                    value={confirmKek}
                    onChange={(e) => setConfirmKek(e.target.value)}
                    placeholder="base64 of the active customer KEK"
                    className="w-full rounded-md border border-cm-border bg-cm-bg px-3 py-2 font-mono text-sm placeholder:text-cm-faint focus:outline-none focus:ring-2 focus:ring-cm-accent"
                  />
                </div>
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] px-3 py-1.5 text-sm font-medium text-[var(--cm-danger)] transition hover:bg-[rgba(180,66,60,0.18)] disabled:opacity-50"
                >
                  {busy === 'remove' ? <Spinner /> : <IconWarning size={14} />}
                  Remove customer KEK
                </button>
              </section>
            )}

            <section className="space-y-3 rounded-lg border border-cm-border bg-cm-paper p-5">
              <div>
                <h2 className="text-base font-semibold">Rotate data encryption key</h2>
                <p className="mt-1 text-sm text-cm-muted">
                  Mints a fresh DEK wrapped under the active KEK. Up to{' '}
                  {16} prior DEKs are retained so existing ciphertext keeps
                  decrypting.
                </p>
              </div>
              <button
                type="button"
                onClick={rotate}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm font-medium transition hover:bg-cm-subtle disabled:opacity-50"
              >
                {busy === 'rotate' ? <Spinner /> : <IconRefresh size={14} />}
                Rotate DEK now
              </button>
            </section>

            {status.archivedKeys.length > 0 ? (
              <section className="rounded-lg border border-cm-border bg-cm-paper p-5">
                <h2 className="text-base font-semibold">Archived keys</h2>
                <p className="mt-1 text-sm text-cm-muted">
                  Previously active DEKs. Kept so older encrypted artifacts
                  remain readable. Bounded to the most recent {16}.
                </p>
                <ul className="mt-3 divide-y divide-cm-border text-sm">
                  {status.archivedKeys.map((a) => (
                    <li key={a.keyId} className="flex items-center justify-between gap-3 py-2">
                      <span className="truncate font-mono text-xs">{a.keyId}</span>
                      <span className="shrink-0 text-xs text-cm-muted">
                        {a.wrappedByKekKind} kek {a.wrappedByKekFingerprintShort}... ·{' '}
                        {fmtDate(a.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
