'use client';
// Owner-only storage maintenance. Two operations:
//   - Compact: drop manifest, BM25, and vector rows whose source file is
//     gone from disk. Safe-by-default with a dry-run preview.
//   - Forget: bulk-remove every indexed source whose absolute path matches
//     a list of globs. Required for "right to be forgotten" requests when
//     the data has already left the filesystem. Type-to-confirm gated.
//
// Both endpoints are owner-only, MFA-stepped, and rate-limited server-side
// (6/min). The audit log records actor, patterns, matched/removed counts.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, ApiError, type CompactReport, type ForgetReport } from '@/lib/api';
import {
  Spinner,
  ErrorState,
  IconShield,
  IconWarning,
  IconCheck,
  IconRefresh,
  IconTrash,
  IconArrowRight,
  IconDatabase,
  IconSettings,
} from '@clawmind/ui';

function explainError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) {
      const b = err.body as { error?: string } | null | undefined;
      if (b?.error === 'mfa step-up required') {
        return 'MFA verification required. Open Settings > MFA, step up, then retry.';
      }
      return 'Sign in required.';
    }
    if (err.status === 403) return 'Owner role and the maintenance scope are required.';
    if (err.status === 423) return 'Workspace is frozen. Release the freeze before running maintenance.';
    if (err.status === 429) return 'Rate limited (6 per minute). Wait a moment and retry.';
    const b = err.body as { error?: string; message?: string } | null | undefined;
    return b?.message || b?.error || `Request failed (${err.status}).`;
  }
  return err instanceof Error ? err.message : 'Unexpected error.';
}

const CONFIRM_PHRASE = 'FORGET';

export default function MaintenancePage() {
  return (
    <div className="min-h-screen bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <header className="mb-6">
          <div className="flex items-center gap-2 text-sm text-cm-muted">
            <Link href="/settings" className="hover:text-cm-fg">Settings</Link>
            <IconArrowRight size={12} />
            <span>Maintenance</span>
          </div>
          <h1 className="mt-1 text-2xl font-medium tracking-tight">Storage maintenance</h1>
          <p className="mt-1 max-w-2xl text-sm text-cm-muted">
            Reclaim space from sources that have been removed from disk, and bulk forget any indexed file that
            matches a glob. Owner only. Every non-preview run requires a fresh MFA step-up and is written to the
            tamper-evident audit log.
          </p>
        </header>

        <CompactCard />
        <ForgetCard />

        <div className="mt-8 text-xs text-cm-muted">
          <Link href="/settings" className="inline-flex items-center gap-1 hover:text-cm-fg">
            <IconSettings size={12} /> Back to settings
          </Link>
        </div>
      </main>
    </div>
  );
}

function CompactCard() {
  const [preview, setPreview] = useState<CompactReport | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applied, setApplied] = useState<CompactReport | null>(null);

  const runPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    setApplied(null);
    try {
      const r = await api.maintenanceCompact(true);
      setPreview(r);
    } catch (err) {
      setPreviewError(explainError(err));
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => { void runPreview(); }, [runPreview]);

  const runApply = async () => {
    if (!preview || preview.removed === 0) return;
    setApplyBusy(true);
    setApplyError(null);
    try {
      const r = await api.maintenanceCompact(false);
      setApplied(r);
      setPreview(r);
    } catch (err) {
      setApplyError(explainError(err));
    } finally {
      setApplyBusy(false);
    }
  };

  const canApply = preview !== null && preview.removed > 0 && !applyBusy;

  return (
    <section className="rounded-lg border border-cm-border bg-cm-paper">
      <header className="flex items-start justify-between gap-3 border-b border-cm-border px-4 py-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md border border-cm-border bg-cm-subtle text-cm-accent">
            <IconDatabase size={14} />
          </span>
          <div>
            <h2 className="text-sm font-medium">Compact dangling rows</h2>
            <p className="text-xs text-cm-muted">
              Drop manifest, BM25, and vector entries for source files that no longer exist on disk.
              Always previews first.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void runPreview()}
          disabled={previewLoading || applyBusy}
          className="inline-flex items-center gap-2 rounded-md border border-cm-border px-2.5 py-1.5 text-xs hover:bg-cm-subtle disabled:opacity-60"
        >
          {previewLoading ? <Spinner size={12} /> : <IconRefresh size={12} />} Re-scan
        </button>
      </header>

      <div className="px-4 py-4 text-sm">
        {previewError ? (
          <ErrorState title="Could not run compact preview" message={previewError} onRetry={() => void runPreview()} />
        ) : previewLoading && preview === null ? (
          <CompactSkeleton />
        ) : preview ? (
          <>
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <Stat label="Scanned" value={preview.scanned} />
              <Stat label="Kept" value={preview.kept} />
              <Stat
                label="Will remove"
                value={preview.removed}
                tone={preview.removed > 0 ? 'warn' : 'ok'}
              />
            </dl>
            {preview.removedPaths && preview.removedPaths.length > 0 ? (
              <div className="mt-3">
                <div className="mb-1 text-xs text-cm-muted">
                  {preview.removed > preview.removedPaths.length
                    ? `First ${preview.removedPaths.length} of ${preview.removed} paths`
                    : 'Paths'}
                </div>
                <ul className="max-h-48 overflow-y-auto rounded-md border border-cm-border bg-cm-bg p-2 text-xs">
                  {preview.removedPaths.map((p) => (
                    <li key={p} className="truncate font-mono" title={p}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : preview.removed === 0 ? (
              <p className="mt-3 text-xs text-cm-muted">Nothing to compact. Every indexed source is still on disk.</p>
            ) : null}
            {applied ? (
              <p className="mt-3 inline-flex items-center gap-2 text-xs text-[var(--cm-success)]">
                <IconCheck size={12} /> Removed {applied.removed} entries. The cache has been cleared.
              </p>
            ) : null}
            {applyError ? (
              <p className="mt-3 inline-flex items-center gap-2 text-xs"><IconWarning size={12} /> {applyError}</p>
            ) : null}
          </>
        ) : null}
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-cm-border px-4 py-3">
        <button
          type="button"
          onClick={runApply}
          disabled={!canApply}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] px-3 py-1.5 text-sm font-medium text-[var(--cm-danger)] transition hover:bg-[rgba(180,66,60,0.18)] disabled:opacity-50"
        >
          {applyBusy ? <Spinner size={12} /> : <IconTrash size={12} />}
          Compact {preview && preview.removed > 0 ? `(${preview.removed})` : ''}
        </button>
      </footer>
    </section>
  );
}

function ForgetCard() {
  const [patternsText, setPatternsText] = useState('');
  const [preview, setPreview] = useState<ForgetReport | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applied, setApplied] = useState<ForgetReport | null>(null);

  const patterns = patternsText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, 50);

  const reset = () => {
    setPreview(null);
    setApplied(null);
    setPreviewError(null);
    setApplyError(null);
    setConfirm('');
  };

  const runPreview = async () => {
    if (patterns.length === 0) {
      setPreviewError('Add at least one glob pattern (one per line).');
      return;
    }
    setPreviewBusy(true);
    setPreviewError(null);
    setApplied(null);
    setConfirm('');
    try {
      const r = await api.maintenanceForget(patterns, true);
      setPreview(r);
    } catch (err) {
      setPreviewError(explainError(err));
      setPreview(null);
    } finally {
      setPreviewBusy(false);
    }
  };

  const runApply = async () => {
    if (!preview || preview.matched === 0 || confirm !== CONFIRM_PHRASE) return;
    setApplyBusy(true);
    setApplyError(null);
    try {
      const r = await api.maintenanceForget(patterns, false);
      setApplied(r);
      setPreview(null);
      setConfirm('');
    } catch (err) {
      setApplyError(explainError(err));
    } finally {
      setApplyBusy(false);
    }
  };

  return (
    <section className="mt-6 rounded-lg border border-cm-border bg-cm-paper">
      <header className="border-b border-cm-border px-4 py-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md border border-cm-border bg-cm-subtle text-cm-accent">
            <IconShield size={14} />
          </span>
          <div>
            <h2 className="text-sm font-medium">Bulk forget by pattern</h2>
            <p className="text-xs text-cm-muted">
              Remove every indexed source whose absolute path matches one of the globs. Used for GDPR
              right-to-be-forgotten requests when the underlying files are already gone.
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-4 px-4 py-4 text-sm">
        <label className="grid gap-1">
          <span className="text-xs text-cm-muted">Glob patterns (one per line, up to 50)</span>
          <textarea
            value={patternsText}
            onChange={(e) => { setPatternsText(e.target.value); reset(); }}
            rows={4}
            spellCheck={false}
            placeholder={'/data/customers/acme/**\n/data/imports/*.pdf'}
            className="rounded-md border border-cm-border bg-cm-bg px-2.5 py-1.5 font-mono text-xs outline-none focus:border-cm-accent focus:ring-2 focus:ring-cm-accent"
          />
          <span className="text-[11px] text-cm-muted">
            picomatch syntax. {patterns.length} pattern{patterns.length === 1 ? '' : 's'} ready.
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void runPreview()}
            disabled={previewBusy || patterns.length === 0}
            className="inline-flex items-center gap-2 rounded-md border border-cm-border px-3 py-1.5 text-sm hover:bg-cm-subtle disabled:opacity-50"
          >
            {previewBusy ? <Spinner size={12} /> : <IconRefresh size={12} />} Preview matches
          </button>
        </div>

        {previewError ? (
          <p className="inline-flex items-center gap-2 text-xs"><IconWarning size={12} /> {previewError}</p>
        ) : null}

        {preview ? (
          <div className="rounded-md border border-cm-border bg-cm-bg p-3">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Stat label="Sources matched" value={preview.matched} tone={preview.matched > 0 ? 'warn' : 'ok'} />
              <Stat label="Chunks to remove" value={preview.removedChunks} tone={preview.removedChunks > 0 ? 'warn' : 'ok'} />
            </dl>
            {preview.removedPaths.length > 0 ? (
              <ul className="mt-3 max-h-48 overflow-y-auto rounded border border-cm-border bg-cm-paper p-2 text-xs">
                {preview.removedPaths.map((p) => (
                  <li key={p} className="truncate font-mono" title={p}>{p}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-cm-muted">No indexed paths match these globs.</p>
            )}

            {preview.matched > 0 ? (
              <div className="mt-4 rounded-md border border-cm-border bg-cm-paper p-3">
                <label className="grid gap-1">
                  <span className="text-xs text-cm-muted">
                    Type <code className="font-mono">{CONFIRM_PHRASE}</code> to confirm. This call requires an active MFA step-up.
                  </span>
                  <input
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="rounded-md border border-cm-border bg-cm-bg px-2.5 py-1.5 text-sm outline-none focus:border-cm-accent focus:ring-2 focus:ring-cm-accent"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </label>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={runApply}
                    disabled={applyBusy || confirm !== CONFIRM_PHRASE}
                    className="inline-flex items-center gap-2 rounded-md border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] px-3 py-1.5 text-sm font-medium text-[var(--cm-danger)] transition hover:bg-[rgba(180,66,60,0.18)] disabled:opacity-50"
                  >
                    {applyBusy ? <Spinner size={12} /> : <IconTrash size={12} />}
                    Forget {preview.matched} source{preview.matched === 1 ? '' : 's'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {applyError ? (
          <p className="inline-flex items-center gap-2 text-xs"><IconWarning size={12} /> {applyError}</p>
        ) : null}
        {applied ? (
          <p className="inline-flex items-center gap-2 text-xs"><IconCheck size={12} />
            Forgot {applied.matched} source{applied.matched === 1 ? '' : 's'} ({applied.removedChunks} chunks). Cache cleared and audit log updated.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Stat({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'ok' | 'warn' }) {
  const color = tone === 'warn' ? 'text-cm-cite' : tone === 'ok' ? 'text-cm-muted' : 'text-cm-fg';
  return (
    <div>
      <div className="text-xs text-cm-muted">{label}</div>
      <div className={`mt-0.5 text-lg font-medium tabular-nums ${color}`}>{value.toLocaleString()}</div>
    </div>
  );
}

function CompactSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i}>
          <div className="h-3 w-16 animate-pulse rounded bg-cm-subtle" />
          <div className="mt-2 h-5 w-12 animate-pulse rounded bg-cm-subtle" />
        </div>
      ))}
    </div>
  );
}
