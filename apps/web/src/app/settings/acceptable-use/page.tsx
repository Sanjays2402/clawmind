'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  type AcceptableUsePolicy,
  type AcceptableUseCoverage,
} from '@/lib/api';
import {
  ErrorState,
  Spinner,
  IconArrowRight,
  IconBook,
  IconCheck,
  IconShield,
  IconWarning,
} from '@clawmind/ui';

function fmtDate(ts: number | null | undefined): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

function shortHash(h: string | null | undefined): string {
  if (!h) return 'unset';
  return h.slice(0, 12);
}

export default function AcceptableUsePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [policy, setPolicy] = useState<AcceptableUsePolicy | null>(null);
  const [viewerAccepted, setViewerAccepted] = useState<boolean | null>(null);

  const [version, setVersion] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [requireAcceptance, setRequireAcceptance] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [coverage, setCoverage] = useState<AcceptableUseCoverage | null>(null);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);

  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.acceptableUseGet();
      setPolicy(res.policy);
      setViewerAccepted(res.viewer?.accepted ?? null);
      setVersion(res.policy.version);
      setTitle(res.policy.title);
      setBody(res.policy.body);
      setRequireAcceptance(res.policy.requireAcceptance);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCoverage = useCallback(async () => {
    setCoverageLoading(true);
    setCoverageError(null);
    try {
      const c = await api.acceptableUseCoverage();
      setCoverage(c);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setCoverageError(null);
      } else {
        setCoverageError(err instanceof Error ? err.message : 'failed to load');
      }
    } finally {
      setCoverageLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadCoverage();
  }, [load, loadCoverage]);

  const dirty = useMemo(() => {
    if (!policy) return false;
    return (
      version !== policy.version ||
      title !== policy.title ||
      body !== policy.body ||
      requireAcceptance !== policy.requireAcceptance
    );
  }, [policy, version, title, body, requireAcceptance]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setSaving(true);
    try {
      const next = await api.acceptableUsePublish({
        version: version.trim(),
        title: title.trim(),
        body,
        requireAcceptance,
      });
      setPolicy(next);
      setSavedAt(Date.now());
      void loadCoverage();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'save failed';
      setActionError(msg);
    } finally {
      setSaving(false);
    }
  };

  const accept = async () => {
    if (!policy || !policy.bodyHash) return;
    setAccepting(true);
    setAcceptError(null);
    try {
      await api.acceptableUseAccept({
        version: policy.version,
        bodyHash: policy.bodyHash,
      });
      setViewerAccepted(true);
      void loadCoverage();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'accept failed';
      setAcceptError(msg);
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-3 text-sm text-muted-foreground">
          <Link href="/settings" className="hover:text-foreground">Settings</Link>
          <IconArrowRight size={14} />
          <span className="text-foreground">Acceptable use policy</span>
        </div>

        <header className="mb-8">
          <div className="flex items-start gap-3">
            <IconBook size={28} className="mt-1 text-primary" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Acceptable use policy</h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Publish a versioned acceptable use policy. When enforcement is on, every member
                must accept the current version before any mutating request is allowed.
              </p>
            </div>
          </div>
        </header>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading policy
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <>
            {policy && policy.version && viewerAccepted === false ? (
              <div className="mb-6 flex items-start justify-between gap-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
                <div className="flex items-start gap-2 text-sm">
                  <IconWarning size={18} className="mt-0.5 text-amber-600" />
                  <div>
                    <p className="font-medium text-foreground">
                      You have not accepted version {policy.version}.
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      Review the policy below and record your acceptance to keep making changes.
                    </p>
                    {acceptError ? <p className="mt-2 text-destructive">{acceptError}</p> : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={accept}
                  disabled={accepting}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {accepting ? <Spinner /> : <IconCheck size={16} />}
                  Accept
                </button>
              </div>
            ) : null}

            {policy && policy.version && viewerAccepted === true ? (
              <div className="mb-6 flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm">
                <IconCheck size={16} className="text-emerald-600" />
                <span>
                  You accepted version {policy.version}. Hash{' '}
                  <span className="font-mono text-xs">{shortHash(policy.bodyHash)}</span>.
                </span>
              </div>
            ) : null}

            <form onSubmit={save} className="space-y-6 rounded-lg border bg-card p-6 shadow-sm">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="aup-version" className="block text-sm font-medium">
                    Version
                  </label>
                  <input
                    id="aup-version"
                    type="text"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="2026-01-01"
                    maxLength={64}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Bump this string to invalidate prior acceptances and require everyone to
                    re-accept.
                  </p>
                </div>
                <div className="space-y-2">
                  <label htmlFor="aup-title" className="block text-sm font-medium">
                    Title
                  </label>
                  <input
                    id="aup-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Acceptable Use Policy"
                    maxLength={200}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="aup-body" className="block text-sm font-medium">
                  Body (markdown)
                </label>
                <textarea
                  id="aup-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={14}
                  maxLength={64 * 1024}
                  placeholder="# Acceptable Use, do not upload prohibited content..."
                  className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  {body.length.toLocaleString()} of 65,536 characters. The SHA-256 of this body
                  is recorded with every acceptance so auditors can verify what was agreed to.
                </p>
              </div>

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={requireAcceptance}
                  onChange={(e) => setRequireAcceptance(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-input"
                />
                <span>
                  <span className="block text-sm font-medium">Block writes until accepted</span>
                  <span className="block text-xs text-muted-foreground">
                    When on, any member who has not accepted the current version receives HTTP
                    412 on every mutating request. API key callers and the workspace owner are
                    exempt. Reads, login, MFA, and GDPR export remain available.
                  </span>
                </span>
              </label>

              {actionError ? (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  <IconWarning size={16} />
                  <span>{actionError}</span>
                </div>
              ) : null}

              <div className="flex items-center justify-between border-t pt-4">
                <p className="text-xs text-muted-foreground">
                  {policy?.version ? (
                    <>
                      Current version <span className="font-mono">{policy.version}</span>{' '}
                      published by{' '}
                      <span className="font-mono">{policy.publishedBy ?? 'unknown'}</span> on{' '}
                      {fmtDate(policy.publishedAt)}. Hash{' '}
                      <span className="font-mono">{shortHash(policy.bodyHash)}</span>.
                    </>
                  ) : (
                    <>No policy published yet.</>
                  )}
                </p>
                <button
                  type="submit"
                  disabled={
                    saving ||
                    !dirty ||
                    version.trim() === '' ||
                    title.trim() === '' ||
                    body.trim() === ''
                  }
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? <Spinner /> : <IconShield size={16} />}
                  Publish
                </button>
              </div>

              {savedAt ? (
                <p className="text-xs text-muted-foreground">Published {fmtDate(savedAt)}.</p>
              ) : null}
            </form>

            <section className="mt-10">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold tracking-tight">Acceptance coverage</h2>
                {coverage ? (
                  <p className="text-xs text-muted-foreground">
                    {coverage.totalAccepted} of {coverage.totalMembers} members accepted version{' '}
                    <span className="font-mono">{coverage.policy.version || 'unset'}</span>.
                  </p>
                ) : null}
              </div>
              {coverageLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner /> Loading coverage
                </div>
              ) : coverageError ? (
                <ErrorState message={coverageError} onRetry={loadCoverage} />
              ) : !coverage ? (
                <p className="text-xs text-muted-foreground">
                  Admin or owner role required to view coverage.
                </p>
              ) : coverage.totalMembers === 0 ? (
                <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
                  No members yet. Invite teammates from settings, members.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <div className="rounded-lg border bg-card p-4">
                    <h3 className="mb-3 text-sm font-medium">
                      Outstanding ({coverage.outstanding.length})
                    </h3>
                    {coverage.outstanding.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Everyone is up to date.</p>
                    ) : (
                      <ul className="space-y-2 text-sm">
                        {coverage.outstanding.map((m) => (
                          <li
                            key={m.userId}
                            className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2"
                          >
                            <span className="truncate">
                              <span className="font-medium">
                                {m.label ?? m.email ?? m.userId}
                              </span>
                              <span className="ml-2 text-xs text-muted-foreground">{m.role}</span>
                            </span>
                            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700">
                              not accepted
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="rounded-lg border bg-card p-4">
                    <h3 className="mb-3 text-sm font-medium">
                      Accepted ({coverage.accepted.length})
                    </h3>
                    {coverage.accepted.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No acceptances recorded.</p>
                    ) : (
                      <ul className="space-y-2 text-sm">
                        {coverage.accepted.map((m) => (
                          <li
                            key={m.userId}
                            className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2"
                          >
                            <span className="truncate">
                              <span className="font-medium">
                                {m.label ?? m.email ?? m.userId}
                              </span>
                              <span className="ml-2 text-xs text-muted-foreground">{m.role}</span>
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {fmtDate(m.acceptedAt)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
