'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  type DpaVersionMeta,
  type DpaVersionFull,
  type DpaAcceptance,
} from '@/lib/api';
import {
  ErrorState,
  Spinner,
  IconArrowRight,
  IconCheck,
  IconDownload,
  IconRefresh,
  IconShield,
  IconWarning,
} from '@clawmind/ui';

// Data Processing Agreement (DPA) acceptance console.
//
// Owner-only mutations (record an acceptance) gated by MFA at the API.
// Admins+ can view the ledger and re-verify signatures. The unauth
// /v1/dpa/status URL underlies the buyer-facing badge that procurement
// can hit before they have workspace credentials.

interface StatusPayload {
  latestVersion: DpaVersionMeta;
  accepted: {
    versionId: string;
    versionLabel: string;
    versionFingerprint: string;
    acceptedAt: number;
  } | null;
  upToDate: boolean;
}

function fmtDate(ts: number): string {
  if (!ts) return 'never';
  try {
    return new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  } catch {
    return 'unknown';
  }
}

function short(fp: string): string {
  if (!fp) return '';
  return fp.length > 16 ? `${fp.slice(0, 8)}…${fp.slice(-8)}` : fp;
}

type SignDraft = {
  signatoryName: string;
  signatoryTitle: string;
  signatoryEmail: string;
  notes: string;
};

const EMPTY_DRAFT: SignDraft = {
  signatoryName: '',
  signatoryTitle: '',
  signatoryEmail: '',
  notes: '',
};

export default function DpaPage() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [versions, setVersions] = useState<DpaVersionMeta[]>([]);
  const [acceptances, setAcceptances] = useState<DpaAcceptance[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [draft, setDraft] = useState<SignDraft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);

  const [openVersion, setOpenVersion] = useState<DpaVersionFull | null>(null);
  const [openVersionLoading, setOpenVersionLoading] = useState(false);

  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, v] = await Promise.all([api.dpaStatus(), api.dpaVersions()]);
      setStatus(s);
      setVersions(v.versions);
      // Acceptance ledger is admin-only; tolerate 401/403 for members.
      try {
        const a = await api.dpaAcceptances();
        setAcceptances(a.acceptances);
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          setAcceptances([]);
        } else {
          throw err;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load DPA status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openBody = useCallback(async (id: string) => {
    setOpenVersionLoading(true);
    setOpenVersion(null);
    try {
      const v = await api.dpaVersion(id);
      setOpenVersion(v);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to load DPA body.');
    } finally {
      setOpenVersionLoading(false);
    }
  }, []);

  const onAccept = useCallback(
    async (ev: React.FormEvent) => {
      ev.preventDefault();
      setActionError(null);
      setSubmitting(true);
      try {
        await api.dpaAccept({
          versionId: status?.latestVersion.id,
          signatoryName: draft.signatoryName.trim(),
          signatoryTitle: draft.signatoryTitle.trim(),
          signatoryEmail: draft.signatoryEmail.trim(),
          notes: draft.notes.trim() ? draft.notes.trim() : null,
        });
        setSavedAt(Date.now());
        setDraft(EMPTY_DRAFT);
        await load();
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 401) setActionError('Sign in required.');
          else if (err.status === 403)
            setActionError('Only the workspace owner can record acceptance. MFA step-up required.');
          else setActionError(err.message);
        } else {
          setActionError(err instanceof Error ? err.message : 'Failed to record acceptance.');
        }
      } finally {
        setSubmitting(false);
      }
    },
    [draft, load, status],
  );

  const onVerify = useCallback(async (id: string) => {
    setVerifying(id);
    try {
      const r = await api.dpaVerify(id);
      setVerifyResult((prev) => ({ ...prev, [id]: r.ok }));
    } catch {
      setVerifyResult((prev) => ({ ...prev, [id]: false }));
    } finally {
      setVerifying(null);
    }
  }, []);

  const onDownload = useCallback(async (id: string) => {
    try {
      const r = await api.dpaReceipt(id);
      const blob = new Blob([JSON.stringify(r, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dpa-receipt-${id}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to download receipt.');
    }
  }, []);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <TopNav />
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <IconShield className="size-6 text-primary" />
              <h1 className="text-2xl font-semibold tracking-tight">Data Processing Agreement</h1>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Enterprise procurement and the buyer&rsquo;s legal team need a signed,
              versioned acceptance of your DPA on file. Acceptances are HMAC&ndash;signed
              and exportable so a reviewer can verify the receipt offline.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted"
          >
            <IconRefresh className="size-4" /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
            <Spinner /> Loading DPA status...
          </div>
        ) : error ? (
          <ErrorState title="Failed to load" message={error} onRetry={() => void load()} />
        ) : (
          <>
            {/* Status banner */}
            <section className="mb-6 rounded-lg border border-border bg-card p-5">
              {status?.accepted ? (
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                      {status.upToDate ? (
                        <>
                          <IconCheck className="size-5 text-green-600" />
                          DPA on file and up to date
                        </>
                      ) : (
                        <>
                          <IconWarning className="size-5 text-amber-600" />
                          DPA on file, but a newer version is available
                        </>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Accepted version{' '}
                      <span className="font-mono">{status.accepted.versionLabel}</span> ({status.accepted.versionId}) on{' '}
                      {fmtDate(status.accepted.acceptedAt)}.
                    </div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">
                      Fingerprint: {short(status.accepted.versionFingerprint)}
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    Latest published: <span className="font-mono">{status.latestVersion.label}</span>
                    <br />
                    Effective {status.latestVersion.effective}
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <IconWarning className="size-5 text-amber-600" />
                    No DPA acceptance on file
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Latest published: <span className="font-mono">{status?.latestVersion.label}</span>
                  </div>
                </div>
              )}
            </section>

            {/* Sign block */}
            <section className="mb-6 rounded-lg border border-border bg-card p-5">
              <h2 className="mb-1 text-lg font-semibold">Record acceptance</h2>
              <p className="mb-4 text-sm text-muted-foreground">
                Owner only. MFA step-up is enforced at the API. Captures actor, IP and timestamp,
                writes an audit-chain entry, and returns a portable signed receipt.
              </p>
              {savedAt && (
                <div className="mb-3 rounded-md border border-green-600/30 bg-green-600/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
                  Acceptance recorded.
                </div>
              )}
              {actionError && (
                <div className="mb-3 rounded-md border border-red-600/30 bg-red-600/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                  {actionError}
                </div>
              )}
              <form onSubmit={onAccept} className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-1 block text-muted-foreground">Signatory name</span>
                  <input
                    required
                    type="text"
                    value={draft.signatoryName}
                    onChange={(e) => setDraft({ ...draft, signatoryName: e.target.value })}
                    className="w-full rounded-md border border-border bg-background px-3 py-2"
                    placeholder="Alice Example"
                    maxLength={200}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-muted-foreground">Signatory title</span>
                  <input
                    required
                    type="text"
                    value={draft.signatoryTitle}
                    onChange={(e) => setDraft({ ...draft, signatoryTitle: e.target.value })}
                    className="w-full rounded-md border border-border bg-background px-3 py-2"
                    placeholder="Chief Information Security Officer"
                    maxLength={200}
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  <span className="mb-1 block text-muted-foreground">Signatory email</span>
                  <input
                    required
                    type="email"
                    value={draft.signatoryEmail}
                    onChange={(e) => setDraft({ ...draft, signatoryEmail: e.target.value })}
                    className="w-full rounded-md border border-border bg-background px-3 py-2"
                    placeholder="alice@acme.example"
                    maxLength={320}
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  <span className="mb-1 block text-muted-foreground">Notes (optional)</span>
                  <textarea
                    value={draft.notes}
                    onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    className="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2"
                    placeholder="e.g. MSA section 12 reference"
                    maxLength={1000}
                  />
                </label>
                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? <Spinner /> : <IconCheck className="size-4" />}
                    Record acceptance of {status?.latestVersion.label}
                  </button>
                </div>
              </form>
            </section>

            {/* Versions */}
            <section className="mb-6 rounded-lg border border-border bg-card p-5">
              <h2 className="mb-1 text-lg font-semibold">Published versions</h2>
              <p className="mb-4 text-sm text-muted-foreground">
                Shipped in the codebase so the buyer can diff exact bytes. Public URL:{' '}
                <span className="font-mono">/v1/dpa/versions</span>
              </p>
              {versions.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No versions shipped.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {versions.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          v{v.label} <span className="text-muted-foreground">({v.id})</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Effective {v.effective} &middot; {v.bodyBytes.toLocaleString()} bytes &middot;{' '}
                          <span className="font-mono">{short(v.fingerprint)}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{v.changelog}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void openBody(v.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs hover:bg-muted"
                      >
                        View body <IconArrowRight className="size-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {openVersionLoading && (
                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner /> Loading body...
                </div>
              )}
              {openVersion && (
                <div className="mt-4 rounded-md border border-border bg-background p-3">
                  <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      v{openVersion.label} ({openVersion.id}) &middot;{' '}
                      <span className="font-mono">{openVersion.fingerprint}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setOpenVersion(null)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      Close
                    </button>
                  </div>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-3 text-xs">
                    {openVersion.body}
                  </pre>
                </div>
              )}
            </section>

            {/* Ledger */}
            <section className="rounded-lg border border-border bg-card p-5">
              <h2 className="mb-1 text-lg font-semibold">Acceptance ledger</h2>
              <p className="mb-4 text-sm text-muted-foreground">
                Admin-only. Each row is a binding acceptance with the signed receipt available for export.
              </p>
              {acceptances === null ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner /> Loading ledger...
                </div>
              ) : acceptances.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No acceptances recorded yet.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {acceptances.map((a) => (
                    <li key={a.id} className="grid gap-2 py-3 sm:grid-cols-[1fr,auto]">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          {a.signatoryName}{' '}
                          <span className="text-muted-foreground">&middot; {a.signatoryTitle}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {a.signatoryEmail} &middot; v{a.versionLabel} ({a.versionId}) &middot;{' '}
                          {fmtDate(a.acceptedAt)} &middot; from {a.acceptedFromIp}
                        </div>
                        <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                          id: {a.id} &middot; sig: {short(a.signature)}
                        </div>
                        {a.notes && (
                          <div className="mt-1 text-xs text-muted-foreground">Notes: {a.notes}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 sm:justify-end">
                        <button
                          type="button"
                          onClick={() => void onVerify(a.id)}
                          disabled={verifying === a.id}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50"
                        >
                          {verifying === a.id ? (
                            <Spinner />
                          ) : verifyResult[a.id] === true ? (
                            <IconCheck className="size-3 text-green-600" />
                          ) : verifyResult[a.id] === false ? (
                            <IconWarning className="size-3 text-red-600" />
                          ) : (
                            <IconShield className="size-3" />
                          )}
                          Verify
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDownload(a.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs hover:bg-muted"
                        >
                          <IconDownload className="size-3" /> Receipt
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 text-xs text-muted-foreground">
                Public status:{' '}
                <Link href="/v1/dpa/status" className="underline hover:text-foreground">
                  /v1/dpa/status
                </Link>{' '}
                &middot; Sub-processors:{' '}
                <Link href="/settings/sub-processors" className="underline hover:text-foreground">
                  /settings/sub-processors
                </Link>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
