'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, ApiError, type ErasureCertificatePublic } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconShield,
  IconRefresh,
  IconCheck,
  IconWarning,

} from '@clawmind/ui';

// GDPR Article 17 erasure certificates.
//
// One row per DSR erasure request the workspace has fulfilled. Each
// row is the externally-verifiable receipt a data subject can hand to
// their auditor. The signature on every row is recomputed on this
// admin view so a quietly-tampered file is visible at a glance.

function fmt(ts: number | null | undefined): string {
  if (!ts) return 'never';
  try {
    return new Date(ts).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  } catch {
    return 'unknown';
  }
}

interface RowState {
  cert: ErasureCertificatePublic;
  signatureValid: boolean | null;
  checking: boolean;
  error: string | null;
}

export default function ErasureCertificatesPage() {
  const [rows, setRows] = useState<RowState[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.erasureCertificateList();
      setRows(
        res.certificates.map((cert) => ({
          cert,
          signatureValid: null,
          checking: false,
          error: null,
        })),
      );
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'failed to load erasure certificates';
      setError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const verifyOne = async (id: string) => {
    setRows((prev) =>
      prev?.map((r) =>
        r.cert.id === id ? { ...r, checking: true, error: null } : r,
      ) ?? prev,
    );
    try {
      const res = await api.erasureCertificateGet(id);
      setRows((prev) =>
        prev?.map((r) =>
          r.cert.id === id
            ? { ...r, checking: false, signatureValid: res.signatureValid }
            : r,
        ) ?? prev,
      );
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'verify failed';
      setRows((prev) =>
        prev?.map((r) =>
          r.cert.id === id
            ? { ...r, checking: false, signatureValid: null, error: msg }
            : r,
        ) ?? prev,
      );
    }
  };

  const downloadOne = (cert: ErasureCertificatePublic) => {
    const blob = new Blob([JSON.stringify(cert, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cert.id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-dvh bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
        <header className="mb-6 flex items-center gap-3">
          <span className="rounded-md border border-cm-border bg-cm-subtle p-2 text-cm-accent">
            <IconShield size={22} />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Erasure certificates
            </h1>
            <p className="text-sm text-cm-muted">
              GDPR Article 17 destruction receipts. One row per fulfilled
              erasure request, signed and verifiable offline.
            </p>
          </div>
        </header>

        <nav className="mb-6 text-sm">
          <Link
            href="/settings"
            className="text-cm-muted hover:text-cm-fg"
          >
            Settings
          </Link>{' '}
          <span className="text-cm-muted">/</span>{' '}
          <span>Erasure certificates</span>
        </nav>

        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs text-cm-muted">
            Public verify endpoint:{' '}
            <code className="rounded bg-cm-subtle px-1 py-0.5 font-mono">
              POST /v1/erasure-certificates/:id/verify
            </code>
          </p>
          <button
            type="button"
            onClick={() => {
              setRefreshing(true);
              void load();
            }}
            className="inline-flex items-center gap-1 rounded-md border border-cm-border px-2 py-1 text-xs transition hover:bg-cm-subtle disabled:opacity-50"
            disabled={refreshing || loading}
          >
            <IconRefresh size={12} />
            Refresh
          </button>
        </div>

        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorState message={error} />
        ) : !rows || rows.length === 0 ? (
          <EmptyState
            title="No certificates yet"
            body="A certificate is minted automatically when a DSR erasure request transitions to fulfilled."
          />
        ) : (
          <ul className="grid gap-3">
            {rows.map(({ cert, signatureValid, checking, error: rowErr }) => (
              <li
                key={cert.id}
                className="rounded-lg border border-cm-border bg-cm-paper p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-medium">{cert.id}</code>
                      {cert.revokedAt ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(180,66,60,0.10)] px-2 py-0.5 text-xs font-medium text-[var(--cm-danger)]">
                          <IconWarning size={12} /> revoked
                        </span>
                      ) : signatureValid === true ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(47,122,85,0.10)] px-2 py-0.5 text-xs font-medium text-[var(--cm-success)]">
                          <IconCheck size={12} /> signature ok
                        </span>
                      ) : signatureValid === false ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(180,66,60,0.10)] px-2 py-0.5 text-xs font-medium text-[var(--cm-danger)]">
                          <IconWarning size={12} /> signature
                          mismatch
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-cm-muted">
                      DSR{' '}
                      <code className="rounded bg-cm-subtle px-1 font-mono">
                        {cert.dsrId}
                      </code>{' '}
                      &middot; workspace {cert.workspaceId}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void verifyOne(cert.id)}
                      disabled={checking}
                      className="rounded-md border border-cm-border px-2 py-1 text-xs transition hover:bg-cm-subtle disabled:opacity-50"
                    >
                      {checking ? 'Verifying' : 'Verify signature'}
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadOne(cert)}
                      className="rounded-md border border-cm-border px-2 py-1 text-xs transition hover:bg-cm-subtle"
                    >
                      Download JSON
                    </button>
                  </div>
                </div>

                <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="text-cm-muted">Fulfilled</dt>
                    <dd>{fmt(cert.fulfilledAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-cm-muted">Issued</dt>
                    <dd>{fmt(cert.issuedAt)}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-cm-muted">Subject fingerprint</dt>
                    <dd className="break-all font-mono">
                      {cert.subjectEmailFingerprint.slice(0, 32)}&hellip;
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-cm-muted">Content fingerprint</dt>
                    <dd className="break-all font-mono">
                      {cert.contentFingerprint}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-cm-muted">Scope</dt>
                    <dd className="whitespace-pre-wrap">{cert.scope || '(none recorded)'}</dd>
                  </div>
                  {cert.revokedReason ? (
                    <div className="sm:col-span-2">
                      <dt className="text-cm-muted">Revoked</dt>
                      <dd>
                        {fmt(cert.revokedAt)} &middot; {cert.revokedReason}
                      </dd>
                    </div>
                  ) : null}
                </dl>

                {rowErr ? (
                  <p className="mt-2 text-xs text-[var(--cm-danger)]">{rowErr}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
