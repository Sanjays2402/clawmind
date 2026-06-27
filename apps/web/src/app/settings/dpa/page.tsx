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

const INPUT_CLS =
  'w-full rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm text-cm-fg placeholder:text-cm-faint outline-none focus:ring-2 focus:ring-cm-accent';

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
    <div className="min-h-dvh bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-md border border-cm-border bg-cm-subtle p-1.5 text-cm-accent">
                <IconShield size={20} />
              </span>
              <h1 className="text-2xl font-semibold tracking-tight">Data Processing Agreement</h1>
            </div>
            <p className="max-w-2xl text-sm text-cm-muted">
              Enterprise procurement and the buyer&rsquo;s legal team need a signed,
              versioned acceptance of your DPA on file. Acceptances are HMAC&ndash;signed
              and exportable so a reviewer can verify the receipt offline.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-md border border-cm-border bg-cm-paper px-3 py-1.5 text-sm transition hover:bg-cm-subtle"
          >
            <IconRefresh size={16} /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 rounded-lg border border-cm-border bg-cm-paper p-6 text-sm text-cm-muted">
            <Spinner /> Loading DPA status...
          </div>
        ) : error ? (
          <ErrorState title="Failed to load" message={error} onRetry={() => void load()} />
        ) : (
          <>
            {/* Status banner */}
            <section
              className={`mb-6 rounded-lg border p-5 ${
                status?.accepted && status.upToDate
                  ? 'border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)]'
                  : status?.accepted
                    ? 'border-cm-cite-line bg-cm-cite-bg'
                    : 'border-cm-cite-line bg-cm-cite-bg'
              }`}
            >
              {status?.accepted ? (
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                      {status.upToDate ? (
                        <>
                          <IconCheck size={18} className="text-[var(--cm-success)]" />
                          DPA on file and up to date
                        </>
                      ) : (
                        <>
                          <IconWarning size={18} className="text-cm-cite" />
                          DPA on file, but a newer version is available
                        </>
                      )}
                    </div>
                    <div className="text-sm text-cm-muted">
                      Accepted version{' '}
                      <span className="font-mono">{status.accepted.versionLabel}</span> ({status.accepted.versionId}) on{' '}
                      {fmtDate(status.accepted.acceptedAt)}.
                    </div>
                    <div className="mt-1 font-mono text-xs text-cm-muted">
                      Fingerprint: {short(status.accepted.versionFingerprint)}
                    </div>
                  </div>
                  <div className="text-right text-xs text-cm-muted">
                    Latest published: <span className="font-mono">{status.latestVersion.label}</span>
                    <br />
                    Effective {status.latestVersion.effective}
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <IconWarning size={18} className="text-cm-cite" />
                    No DPA acceptance on file
                  </div>
                  <div className="text-xs text-cm-muted">
                    Latest published: <span className="font-mono">{status?.latestVersion.label}</span>
                  </div>
                </div>
              )}
            </section>

            {/* Sign block */}
            <section className="mb-6 rounded-lg border border-cm-border bg-cm-paper p-5">
              <h2 className="mb-1 text-lg font-semibold">Record acceptance</h2>
              <p className="mb-4 text-sm text-cm-muted">
                Owner only. MFA step-up is enforced at the API. Captures actor, IP and timestamp,
                writes an audit-chain entry, and returns a portable signed receipt.
              </p>
              {savedAt && (
                <div className="mb-3 rounded-md border border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] px-3 py-2 text-sm text-[var(--cm-success)]">
                  Acceptance recorded.
                </div>
              )}
              {actionError && (
                <div className="mb-3 rounded-md border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] px-3 py-2 text-sm text-[var(--cm-danger)]">
                  {actionError}
                </div>
              )}
              <form onSubmit={onAccept} className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-1 block text-cm-muted">Signatory name</span>
                  <input
                    required
                    type="text"
                    value={draft.signatoryName}
                    onChange={(e) => setDraft({ ...draft, signatoryName: e.target.value })}
                    className={INPUT_CLS}
                    placeholder="Alice Example"
                    maxLength={200}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-cm-muted">Signatory title</span>
                  <input
                    required
                    type="text"
                    value={draft.signatoryTitle}
                    onChange={(e) => setDraft({ ...draft, signatoryTitle: e.target.value })}
                    className={INPUT_CLS}
                    placeholder="Chief Information Security Officer"
                    maxLength={200}
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  <span className="mb-1 block text-cm-muted">Signatory email</span>
                  <input
                    required
                    type="email"
                    value={draft.signatoryEmail}
                    onChange={(e) => setDraft({ ...draft, signatoryEmail: e.target.value })}
                    className={INPUT_CLS}
                    placeholder="alice@acme.example"
                    maxLength={320}
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  <span className="mb-1 block text-cm-muted">Notes (optional)</span>
                  <textarea
                    value={draft.notes}
                    onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    className={`min-h-20 ${INPUT_CLS}`}
                    placeholder="e.g. MSA section 12 reference"
                    maxLength={1000}
                  />
                </label>
                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-2 rounded-md bg-cm-fg px-4 py-2 text-sm font-medium text-cm-bg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? <Spinner /> : <IconCheck size={16} />}
                    Record acceptance of {status?.latestVersion.label}
                  </button>
                </div>
              </form>
            </section>

            {/* Versions */}
            <section className="mb-6 rounded-lg border border-cm-border bg-cm-paper p-5">
              <h2 className="mb-1 text-lg font-semibold">Published versions</h2>
              <p className="mb-4 text-sm text-cm-muted">
                Shipped in the codebase so the buyer can diff exact bytes. Public URL:{' '}
                <span className="font-mono">/v1/dpa/versions</span>
              </p>
              {versions.length === 0 ? (
                <div className="rounded-md border border-dashed border-cm-border p-6 text-center text-sm text-cm-muted">
                  No versions shipped.
                </div>
              ) : (
                <ul className="divide-y divide-cm-border">
                  {versions.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          v{v.label} <span className="text-cm-muted">({v.id})</span>
                        </div>
                        <div className="text-xs text-cm-muted">
                          Effective {v.effective} &middot; {v.bodyBytes.toLocaleString()} bytes &middot;{' '}
                          <span className="font-mono">{short(v.fingerprint)}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-cm-muted">{v.changelog}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void openBody(v.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-cm-border bg-cm-bg px-2.5 py-1 text-xs transition hover:bg-cm-subtle"
                      >
                        View body <IconArrowRight size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {openVersionLoading && (
                <div className="mt-4 flex items-center gap-2 text-sm text-cm-muted">
                  <Spinner /> Loading body...
                </div>
              )}
              {openVersion && (
                <div className="mt-4 rounded-md border border-cm-border bg-cm-bg p-3">
                  <div className="mb-2 flex items-center justify-between gap-2 text-xs text-cm-muted">
                    <span>
                      v{openVersion.label} ({openVersion.id}) &middot;{' '}
                      <span className="font-mono">{openVersion.fingerprint}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setOpenVersion(null)}
                      className="text-cm-muted hover:text-cm-fg"
                    >
                      Close
                    </button>
                  </div>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-cm-subtle p-3 text-xs">
                    {openVersion.body}
                  </pre>
                </div>
              )}
            </section>

            {/* Ledger */}
            <section className="rounded-lg border border-cm-border bg-cm-paper p-5">
              <h2 className="mb-1 text-lg font-semibold">Acceptance ledger</h2>
              <p className="mb-4 text-sm text-cm-muted">
                Admin-only. Each row is a binding acceptance with the signed receipt available for export.
              </p>
              {acceptances === null ? (
                <div className="flex items-center gap-2 text-sm text-cm-muted">
                  <Spinner /> Loading ledger...
                </div>
              ) : acceptances.length === 0 ? (
                <div className="rounded-md border border-dashed border-cm-border p-6 text-center text-sm text-cm-muted">
                  No acceptances recorded yet.
                </div>
              ) : (
                <ul className="divide-y divide-cm-border">
                  {acceptances.map((a) => (
                    <li key={a.id} className="grid gap-2 py-3 sm:grid-cols-[1fr,auto]">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          {a.signatoryName}{' '}
                          <span className="text-cm-muted">&middot; {a.signatoryTitle}</span>
                        </div>
                        <div className="text-xs text-cm-muted">
                          {a.signatoryEmail} &middot; v{a.versionLabel} ({a.versionId}) &middot;{' '}
                          {fmtDate(a.acceptedAt)} &middot; from {a.acceptedFromIp}
                        </div>
                        <div className="mt-0.5 font-mono text-xs text-cm-muted">
                          id: {a.id} &middot; sig: {short(a.signature)}
                        </div>
                        {a.notes && (
                          <div className="mt-1 text-xs text-cm-muted">Notes: {a.notes}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 sm:justify-end">
                        <button
                          type="button"
                          onClick={() => void onVerify(a.id)}
                          disabled={verifying === a.id}
                          className="inline-flex items-center gap-1 rounded-md border border-cm-border bg-cm-bg px-2.5 py-1 text-xs transition hover:bg-cm-subtle disabled:opacity-50"
                        >
                          {verifying === a.id ? (
                            <Spinner />
                          ) : verifyResult[a.id] === true ? (
                            <IconCheck size={12} className="text-[var(--cm-success)]" />
                          ) : verifyResult[a.id] === false ? (
                            <IconWarning size={12} className="text-[var(--cm-danger)]" />
                          ) : (
                            <IconShield size={12} />
                          )}
                          Verify
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDownload(a.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-cm-border bg-cm-bg px-2.5 py-1 text-xs transition hover:bg-cm-subtle"
                        >
                          <IconDownload size={12} /> Receipt
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 text-xs text-cm-muted">
                Public status:{' '}
                <Link href="/v1/dpa/status" className="text-cm-accent hover:underline">
                  /v1/dpa/status
                </Link>{' '}
                &middot; Sub-processors:{' '}
                <Link href="/settings/sub-processors" className="text-cm-accent hover:underline">
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
