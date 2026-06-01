'use client';
// Owner-only workflow for issuing and verifying audit inclusion proofs.
//
// The chained audit log plus signed anchors prove the workspace's full
// log is intact. A procurement reviewer or external auditor often asks
// the narrower question: "prove this specific event was in your log on
// this date." An inclusion proof is a small, HMAC-signed certificate
// that pins one event to its position in the chain at issuance. The
// reviewer can recompute SHA-256 over the embedded event body and the
// HMAC over the certificate body to verify both the event content and
// the issuance metadata, fully offline.

import { useCallback, useState } from 'react';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  fmtRelative,
  type AuditInclusionProof,
} from '@/lib/api';
import {
  ErrorState,
  Spinner,
  IconCheck,
  IconKey,
  IconWarning,
  IconCopy,
  IconDownload,
  IconRefresh,
} from '@clawmind/ui';

type VerifyResult = Awaited<ReturnType<typeof api.auditProofVerify>>;

interface IssueState {
  loading: boolean;
  proof: AuditInclusionProof | null;
  error: string | null;
}

interface VerifyState {
  loading: boolean;
  result: VerifyResult | null;
  error: string | null;
}

const EMPTY_ISSUE: IssueState = { loading: false, proof: null, error: null };
const EMPTY_VERIFY: VerifyState = { loading: false, result: null, error: null };

function fmtAbsolute(ts: number): string {
  return new Date(ts).toLocaleString();
}

function reasonLabel(r: VerifyResult['reason']): string {
  switch (r) {
    case 'event-hash-mismatch':
      return 'Event body has been altered since issuance.';
    case 'bad-signature':
      return 'Signature does not match. Certificate body was changed or signed with a different secret.';
    case 'missing-event-hash':
      return 'Embedded event has no chained hash. Certificate cannot be verified.';
    case null:
      return 'All checks passed.';
  }
}

export default function AuditProofsPage() {
  const [eventId, setEventId] = useState('');
  const [issue, setIssue] = useState<IssueState>(EMPTY_ISSUE);

  const [pasted, setPasted] = useState('');
  const [verify, setVerify] = useState<VerifyState>(EMPTY_VERIFY);

  const onIssue = useCallback(async () => {
    const id = eventId.trim();
    if (!id) return;
    setIssue({ loading: true, proof: null, error: null });
    try {
      const r = await api.auditProofIssue(id);
      setIssue({ loading: false, proof: r.proof, error: null });
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.status === 404
            ? 'No audit event with that id.'
            : err.status === 409
            ? 'Audit chain is currently failing verification. Resolve that before issuing proofs.'
            : err.message
          : 'Failed to issue proof.';
      setIssue({ loading: false, proof: null, error: msg });
    }
  }, [eventId]);

  const onVerify = useCallback(async () => {
    setVerify({ loading: true, result: null, error: null });
    let parsed: AuditInclusionProof;
    try {
      const obj = JSON.parse(pasted);
      // Accept either the raw proof or the wrapper returned by the issue
      // endpoint, since users will copy from either.
      parsed = (obj.proof ?? obj) as AuditInclusionProof;
    } catch {
      setVerify({
        loading: false,
        result: null,
        error: 'That does not parse as JSON.',
      });
      return;
    }
    try {
      const r = await api.auditProofVerify(parsed);
      setVerify({ loading: false, result: r, error: null });
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : 'Failed to verify proof.';
      setVerify({ loading: false, result: null, error: msg });
    }
  }, [pasted]);

  const onCopy = useCallback(() => {
    if (!issue.proof) return;
    void navigator.clipboard.writeText(JSON.stringify(issue.proof, null, 2));
  }, [issue.proof]);

  const onDownload = useCallback(() => {
    if (!issue.proof) return;
    const blob = new Blob([JSON.stringify(issue.proof, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-proof-${issue.proof.event.id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [issue.proof]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <header className="mb-6 flex items-start gap-3">
          <IconKey size={24} className="mt-1 shrink-0 text-foreground/70" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Audit inclusion proofs
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-foreground/70">
              Mint an offline verifiable certificate that pins one audit
              event to its position in the chain. Hand a copy to an auditor
              and they can confirm later that the event was logged and has
              not been altered.
            </p>
          </div>
        </header>

        <section
          aria-labelledby="issue-heading"
          className="rounded-lg border border-border bg-card p-5 shadow-sm"
        >
          <h2 id="issue-heading" className="text-base font-semibold">
            Issue a proof
          </h2>
          <p className="mt-1 text-sm text-foreground/70">
            Paste the event id from the audit log. The certificate is signed
            with the workspace HMAC secret and includes a snapshot of the
            chain head at the moment of issuance.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <label htmlFor="event-id" className="sr-only">
              Audit event id
            </label>
            <input
              id="event-id"
              type="text"
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              placeholder="e.g. 7d3c1a..."
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={onIssue}
              disabled={issue.loading || !eventId.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {issue.loading ? <Spinner /> : <IconRefresh size={16} />}
              Issue proof
            </button>
          </div>
          {issue.error ? (
            <div className="mt-4">
              <ErrorState message={issue.error} />
            </div>
          ) : null}
          {issue.proof ? (
            <div className="mt-4 space-y-3">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-md border border-border bg-background/50 p-4 text-sm sm:grid-cols-[12rem_1fr]">
                <dt className="text-foreground/60">Certificate id</dt>
                <dd className="font-mono text-xs break-all">{issue.proof.id}</dd>
                <dt className="text-foreground/60">Issued</dt>
                <dd>{fmtAbsolute(issue.proof.ts)} ({fmtRelative(issue.proof.ts)})</dd>
                <dt className="text-foreground/60">Event id</dt>
                <dd className="font-mono text-xs break-all">{issue.proof.event.id}</dd>
                <dt className="text-foreground/60">Position</dt>
                <dd>{issue.proof.position} of {issue.proof.chainChecked}</dd>
                <dt className="text-foreground/60">Event hash</dt>
                <dd className="font-mono text-xs break-all">{issue.proof.eventHash}</dd>
                <dt className="text-foreground/60">Chain head</dt>
                <dd className="font-mono text-xs break-all">{issue.proof.chainHeadHash ?? 'genesis'}</dd>
                <dt className="text-foreground/60">HMAC</dt>
                <dd className="font-mono text-xs break-all">{issue.proof.hmac}</dd>
              </dl>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onCopy}
                  className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background"
                >
                  <IconCopy size={16} /> Copy JSON
                </button>
                <button
                  type="button"
                  onClick={onDownload}
                  className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background"
                >
                  <IconDownload size={16} /> Download
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section
          aria-labelledby="verify-heading"
          className="mt-6 rounded-lg border border-border bg-card p-5 shadow-sm"
        >
          <h2 id="verify-heading" className="text-base font-semibold">
            Verify a proof
          </h2>
          <p className="mt-1 text-sm text-foreground/70">
            Paste a certificate JSON. The server recomputes the event hash
            and the HMAC and reports which checks passed. Verification is
            stateless, so any historic certificate can be checked here.
          </p>
          <label htmlFor="proof-json" className="sr-only">
            Certificate JSON
          </label>
          <textarea
            id="proof-json"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder='{"id":"...","ts":..., "event":{...}, "hmac":"..."}'
            className="mt-3 h-48 w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
            spellCheck={false}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onVerify}
              disabled={verify.loading || !pasted.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {verify.loading ? <Spinner /> : <IconCheck size={16} />}
              Verify
            </button>
            {verify.result ? (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  verify.result.ok
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                }`}
              >
                {verify.result.ok ? (
                  <IconCheck size={14} />
                ) : (
                  <IconWarning size={14} />
                )}
                {verify.result.ok ? 'Valid' : 'Invalid'}
              </span>
            ) : null}
          </div>
          {verify.error ? (
            <div className="mt-4">
              <ErrorState message={verify.error} />
            </div>
          ) : null}
          {verify.result ? (
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 rounded-md border border-border bg-background/50 p-4 text-sm sm:grid-cols-[12rem_1fr]">
              <dt className="text-foreground/60">Event hash valid</dt>
              <dd>{verify.result.eventHashValid ? 'Yes' : 'No'}</dd>
              <dt className="text-foreground/60">Signature valid</dt>
              <dd>{verify.result.signatureValid ? 'Yes' : 'No'}</dd>
              <dt className="text-foreground/60">Recomputed hash</dt>
              <dd className="font-mono text-xs break-all">{verify.result.recomputedEventHash}</dd>
              <dt className="text-foreground/60">Reason</dt>
              <dd>{reasonLabel(verify.result.reason)}</dd>
            </dl>
          ) : null}
        </section>
      </main>
    </div>
  );
}
