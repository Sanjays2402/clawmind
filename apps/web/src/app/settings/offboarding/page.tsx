'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, ApiError } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  SettingsCardSkeleton,
  Spinner,
  IconArrowRight,
  IconCheck,
  IconKey,
  IconRefresh,
  IconShield,
  IconTrash,
  IconWarning,
} from '@clawmind/ui';

// Workspace offboarding cleanup.
//
// Removing a member (manually or via SCIM) now revokes every API key and
// session that member owned, in the same transaction. This page surfaces
// the residual cases: API keys whose owning userId is no longer in the
// workspace member registry. On a healthy workspace this list stays
// empty. When it is not, an owner can revoke each orphan from here.

type Orphan = {
  id: string;
  userId: string;
  label: string;
  role: 'owner' | 'reader';
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
};

function fmtDate(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

function explainError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Sign in to manage offboarding cleanup.';
    if (err.status === 403) return 'Owner role required to revoke orphaned keys.';
    if (err.status === 412) return 'A recent MFA step-up is required. Verify on the MFA page and retry.';
    if (err.status === 409) {
      const body = err.body as { error?: string } | null;
      if (body?.error === 'still-member') return 'That user is a current member again. Refresh.';
      if (body?.error === 'already-revoked') return 'Already revoked. Refresh.';
    }
    if (err.status === 404) return 'Key not found. It may have been deleted already.';
    const body = err.body as { error?: string; message?: string } | null;
    return body?.message || body?.error || err.message;
  }
  return err instanceof Error ? err.message : 'Unexpected error.';
}

export default function OffboardingPage() {
  const [orphans, setOrphans] = useState<Orphan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revokedAt, setRevokedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.offboardingOrphans();
      setOrphans(r.orphans);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRevoke = useCallback(
    async (id: string) => {
      setBusyId(id);
      setActionError(null);
      try {
        await api.offboardingRevokeOrphan(id);
        setRevokedAt(Date.now());
        await load();
      } catch (err) {
        setActionError(explainError(err));
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const orphanCount = orphans?.length ?? 0;

  return (
    <div className="min-h-screen bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="rounded-md border border-cm-border bg-cm-subtle p-2 text-cm-accent">
              <IconShield size={22} />
            </span>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Offboarding cleanup
            </h1>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:bg-cm-subtle hover:text-cm-fg disabled:opacity-50"
            aria-label="Refresh"
          >
            <IconRefresh size={14} />
            Refresh
          </button>
        </div>

        <p className="mb-6 max-w-2xl text-sm text-cm-muted">
          When a member is removed, either from{' '}
          <Link className="underline hover:text-cm-fg" href="/settings/members">
            Members
          </Link>{' '}
          or via{' '}
          <Link className="underline hover:text-cm-fg" href="/settings/scim">
            SCIM
          </Link>
          , every API key and active session they owned is revoked in the
          same operation. This page lists API keys whose owning user is no
          longer a member of this workspace. On a healthy workspace this
          list stays empty.
        </p>

        {actionError ? (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] p-3 text-sm text-cm-danger">
            <IconWarning size={16} className="mt-0.5 shrink-0" />
            <div>{actionError}</div>
          </div>
        ) : null}

        {revokedAt ? (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] p-3 text-sm text-cm-success">
            <IconCheck size={16} className="shrink-0" />
            Orphan revoked at {new Date(revokedAt).toLocaleTimeString()}.
          </div>
        ) : null}

        {loading && !orphans ? (
          <SettingsCardSkeleton rows={3} />
        ) : error ? (
          <ErrorState title="Could not load offboarding state" message={error} onRetry={load} />
        ) : (
          <section className="overflow-hidden rounded-xl border border-cm-border bg-cm-paper">
            <header className="flex items-center justify-between border-b border-cm-border px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-medium text-cm-fg">
                <IconKey size={14} />
                Orphaned API keys
              </div>
              {orphans ? (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${
                    orphanCount === 0
                      ? 'border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] text-cm-success'
                      : 'border-cm-cite-line bg-cm-cite-bg text-cm-cite'
                  }`}
                >
                  {orphanCount === 0 ? <IconCheck size={12} /> : <IconWarning size={12} />}
                  {orphanCount} {orphanCount === 1 ? 'key' : 'keys'}
                </span>
              ) : null}
            </header>

            {!orphans || orphanCount === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={<IconCheck size={20} className="text-cm-success" />}
                  title="No orphaned credentials"
                  body="Every active API key belongs to a current workspace member. Removals sweep keys and sessions atomically."
                />
              </div>
            ) : (
              <ul className="divide-y divide-cm-border">
                {orphans.map((o) => (
                  <li key={o.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm text-cm-fg">
                        <span className="font-medium">{o.label || 'unlabeled key'}</span>
                        <span className="rounded border border-cm-border px-1.5 py-0.5 text-xs text-cm-muted">
                          {o.role}
                        </span>
                      </div>
                      <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs text-cm-muted sm:grid-cols-2">
                        <div>
                          <dt className="inline">Owner: </dt>
                          <dd className="inline cm-mono">{o.userId}</dd>
                        </div>
                        <div>
                          <dt className="inline">Created: </dt>
                          <dd className="inline">{fmtDate(o.createdAt)}</dd>
                        </div>
                        <div>
                          <dt className="inline">Last used: </dt>
                          <dd className="inline">{fmtDate(o.lastUsedAt)}</dd>
                        </div>
                        <div>
                          <dt className="inline">Expires: </dt>
                          <dd className="inline">{fmtDate(o.expiresAt)}</dd>
                        </div>
                      </dl>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onRevoke(o.id)}
                        disabled={busyId !== null}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] px-3 py-1.5 text-sm font-medium text-cm-danger transition hover:bg-[rgba(180,66,60,0.18)] disabled:opacity-50"
                      >
                        {busyId === o.id ? <Spinner /> : <IconTrash size={14} />}
                        Revoke
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className="mt-6 text-sm text-cm-muted">
          <Link className="inline-flex items-center gap-1 underline hover:text-cm-fg" href="/settings/members">
            Manage members
            <IconArrowRight size={12} />
          </Link>
        </div>
      </main>
    </div>
  );
}
