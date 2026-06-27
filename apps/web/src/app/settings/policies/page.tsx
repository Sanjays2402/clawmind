'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  type Policy,
  type PolicyAcceptance,
  type PolicyAcceptanceSummary,
  type PolicyKind,
} from '@/lib/api';
import {
  ErrorState,
  Spinner,
  EmptyState,
  IconArrowRight,
  IconBook,
  IconCheck,
  IconRefresh,
  IconShield,
  IconWarning,
} from '@clawmind/ui';

const KIND_LABEL: Record<PolicyKind, string> = {
  tos: 'Terms of Service',
  dpa: 'Data Processing Addendum',
  aup: 'Acceptable Use Policy',
};

function fmtDate(ts: number | null | undefined): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

function shortHash(h: string): string {
  return h.slice(0, 12);
}

export default function PoliciesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acceptances, setAcceptances] = useState<PolicyAcceptance[]>([]);
  const [unmet, setUnmet] = useState<Policy[]>([]);
  const [current, setCurrent] = useState<Policy[]>([]);

  // Admin-only summary; may 403, which we treat as a non-error hidden panel.
  const [summary, setSummary] = useState<PolicyAcceptanceSummary[] | null>(null);
  const [adminView, setAdminView] = useState(false);

  // Owner publish form state.
  const [kind, setKind] = useState<PolicyKind>('tos');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [required, setRequired] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishedAt, setPublishedAt] = useState<number | null>(null);

  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const me = await api.policiesMe();
      setAcceptances(me.acceptances);
      setUnmet(me.unmet);
      setCurrent(me.current);
      try {
        const items = await api.policiesSummary();
        setSummary(items);
        setAdminView(true);
      } catch (err) {
        if (err instanceof ApiError && (err.status === 403 || err.status === 401)) {
          setAdminView(false);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const acceptedIds = useMemo(
    () => new Set(acceptances.map((a) => a.policyId)),
    [acceptances],
  );

  const accept = async (policyId: string) => {
    setAcceptError(null);
    setAcceptingId(policyId);
    try {
      await api.policiesAccept(policyId);
      await load();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'accept failed';
      setAcceptError(msg);
    } finally {
      setAcceptingId(null);
    }
  };

  const publish = async (e: React.FormEvent) => {
    e.preventDefault();
    setPublishError(null);
    setPublishing(true);
    try {
      await api.policiesPublish({
        kind,
        title: title.trim(),
        body,
        required,
      });
      setPublishedAt(Date.now());
      setTitle('');
      setBody('');
      setRequired(true);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPublishError('Owner role with active MFA step-up is required to publish.');
      } else if (err instanceof ApiError && err.status === 401) {
        setPublishError('Sign in is required.');
      } else {
        setPublishError(err instanceof Error ? err.message : 'publish failed');
      }
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="min-h-screen bg-cm-bg">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconBook size={22} />
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Workspace policies
            </h1>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-md border border-cm-border bg-cm-paper px-2.5 py-1.5 text-sm text-cm-fg hover:bg-cm-subtle"
          >
            <IconRefresh size={14} /> Refresh
          </button>
        </div>

        <p className="mb-6 text-sm text-cm-muted">
          Track and enforce Terms of Service, Data Processing Addendum, and Acceptable
          Use Policy versions. Required policies gate API and UI access until every
          user has accepted the latest version.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-cm-muted">
            <Spinner /> Loading policies
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <div className="space-y-8">
            {unmet.length > 0 && (
              <section
                aria-label="Action required"
                className="rounded-lg border border-[var(--cm-cite-line)] bg-[var(--cm-cite-bg)] p-4"
              >
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--cm-cite)]">
                  <IconWarning size={16} /> Action required
                </div>
                <p className="mb-4 text-sm text-cm-muted">
                  You have not yet accepted the latest required version of the
                  following policies. New API requests outside the policy and account
                  endpoints will return HTTP 451 until you do.
                </p>
                {acceptError && (
                  <div className="mb-3 text-sm text-[var(--cm-danger)]">{acceptError}</div>
                )}
                <ul className="space-y-3">
                  {unmet.map((p) => (
                    <li
                      key={p.id}
                      className="rounded-md border border-cm-border bg-cm-paper p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium">
                            {KIND_LABEL[p.kind]}: {p.title}
                          </div>
                          <div className="text-xs text-cm-muted">
                            Version {shortHash(p.bodyHash)} | effective{' '}
                            {fmtDate(p.effectiveAt)}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={acceptingId === p.id}
                          onClick={() => void accept(p.id)}
                          className="inline-flex items-center gap-1.5 rounded-md bg-cm-fg px-2.5 py-1.5 text-sm font-medium text-cm-bg hover:opacity-90 disabled:opacity-50"
                        >
                          {acceptingId === p.id ? <Spinner /> : <IconCheck size={14} />}
                          Accept
                        </button>
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-cm-muted">
                          Read policy text
                        </summary>
                        <pre className="cm-mono mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-cm-border bg-cm-bg p-3 text-xs">
                          {p.body}
                        </pre>
                      </details>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section aria-label="Current policies">
              <h2 className="mb-3 text-sm font-medium text-cm-fg">
                Currently in force
              </h2>
              {current.length === 0 ? (
                <EmptyState
                  icon={<IconShield size={18} />}
                  title="No policies published"
                  body="An owner has not yet published a TOS, DPA, or AUP. Publish one below to start tracking acceptance."
                />
              ) : (
                <ul className="divide-y divide-cm-border rounded-lg border border-cm-border bg-cm-paper">
                  {current.map((p) => {
                    const accepted = acceptedIds.has(p.id);
                    return (
                      <li key={p.id} className="flex items-center justify-between gap-3 p-3">
                        <div>
                          <div className="text-sm font-medium">
                            {KIND_LABEL[p.kind]}: {p.title}
                          </div>
                          <div className="text-xs text-cm-muted">
                            {p.required ? 'Required' : 'Optional'} | version{' '}
                            {shortHash(p.bodyHash)} | effective {fmtDate(p.effectiveAt)}
                          </div>
                        </div>
                        <span
                          className={
                            accepted
                              ? 'inline-flex items-center gap-1 rounded-full border border-[var(--cm-success)] px-2 py-0.5 text-xs text-[var(--cm-success)]'
                              : 'inline-flex items-center gap-1 rounded-full border border-cm-border px-2 py-0.5 text-xs text-cm-muted'
                          }
                        >
                          {accepted ? (
                            <>
                              <IconCheck size={12} /> Accepted
                            </>
                          ) : (
                            'Not accepted'
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {adminView && summary && (
              <section aria-label="Workspace acceptance summary">
                <h2 className="mb-3 text-sm font-medium text-cm-fg">
                  Workspace acceptance
                </h2>
                {summary.length === 0 ? (
                  <p className="text-sm text-cm-muted">
                    Publish a policy below to start tracking acceptance counts.
                  </p>
                ) : (
                  <ul className="divide-y divide-cm-border rounded-lg border border-cm-border bg-cm-paper">
                    {summary.map((s) => (
                      <li
                        key={s.policy.id}
                        className="flex items-center justify-between gap-3 p-3"
                      >
                        <div>
                          <div className="text-sm font-medium">
                            {KIND_LABEL[s.policy.kind]}: {s.policy.title}
                          </div>
                          <div className="text-xs text-cm-muted">
                            Version {shortHash(s.policy.bodyHash)}
                          </div>
                        </div>
                        <span className="rounded-full border border-cm-border px-2 py-0.5 text-xs text-cm-fg">
                          {s.acceptedCount} accepted
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <section aria-label="Publish a new version">
              <h2 className="mb-3 text-sm font-medium text-cm-fg">
                Publish a new version
              </h2>
              <p className="mb-3 text-xs text-cm-muted">
                Owner role with active MFA step-up required. A new required version
                immediately re-gates every user until they accept it.
              </p>
              <form
                onSubmit={publish}
                className="space-y-3 rounded-lg border border-cm-border bg-cm-paper p-4"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-xs text-cm-muted">Kind</span>
                    <select
                      value={kind}
                      onChange={(e) => setKind(e.target.value as PolicyKind)}
                      className="rounded-md border border-cm-border bg-cm-bg px-2 py-1.5 text-sm outline-none focus:border-cm-border-strong"
                    >
                      <option value="tos">Terms of Service</option>
                      <option value="dpa">Data Processing Addendum</option>
                      <option value="aup">Acceptable Use Policy</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-xs text-cm-muted">Title</span>
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      maxLength={200}
                      placeholder="e.g. Acme TOS v3"
                      className="rounded-md border border-cm-border bg-cm-bg px-2 py-1.5 text-sm outline-none focus:border-cm-border-strong"
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-cm-muted">Body (markdown)</span>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={8}
                    maxLength={200_000}
                    placeholder="Full policy text. Will be hashed for tamper detection."
                    className="cm-mono rounded-md border border-cm-border bg-cm-bg px-2 py-1.5 text-xs outline-none focus:border-cm-border-strong"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={required}
                    onChange={(e) => setRequired(e.target.checked)}
                    className="accent-[var(--cm-accent)]"
                  />
                  <span>Required (gate users until accepted)</span>
                </label>
                {publishError && (
                  <div className="text-sm text-[var(--cm-danger)]">{publishError}</div>
                )}
                {publishedAt && !publishError && (
                  <div className="text-xs text-[var(--cm-success)]">
                    Published at {fmtDate(publishedAt)}
                  </div>
                )}
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="submit"
                    disabled={publishing || !title.trim() || !body.trim()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-cm-fg px-3 py-1.5 text-sm font-medium text-cm-bg hover:opacity-90 disabled:opacity-50"
                  >
                    {publishing ? <Spinner /> : <IconArrowRight size={14} />}
                    Publish
                  </button>
                </div>
              </form>
            </section>

            <div className="text-xs text-cm-muted">
              <Link href="/settings" className="underline">
                Back to settings
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
