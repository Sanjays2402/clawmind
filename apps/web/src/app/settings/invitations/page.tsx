'use client';
// Workspace invitations admin page.
//
// Email-bound, single-use tokens. The list refreshes after every mutation
// so the "pending" badge reflects what the server actually has. Newly
// minted tokens are shown exactly once in a one-time reveal panel and
// must be copied out before the operator dismisses it; the registry on
// disk only keeps the sha256 digest.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  fmtRelative,
  ApiError,
  type InvitationRecord,
  type InvitationCreateResponse,
  type MemberRole,
} from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconUsers,
  IconShield,
  IconTrash,
  IconPlus,
  IconCheck,
  IconWarning,
  IconCopy,
  IconArrowRight,
  IconClockCountdown,
  IconAt,
} from '@clawmind/ui';

const ROLE_OPTIONS: { value: MemberRole; label: string; help: string }[] = [
  { value: 'owner', label: 'Owner', help: 'Full control. Owners only.' },
  { value: 'admin', label: 'Admin', help: 'Manage members, keys, webhooks, retention.' },
  { value: 'member', label: 'Member', help: 'Standard read and write access.' },
  { value: 'viewer', label: 'Viewer', help: 'Read only.' },
];

const TTL_PRESETS = [
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
];

function roleLabel(r: MemberRole): string {
  return ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r;
}

function statusTone(status: InvitationRecord['status']): string {
  switch (status) {
    case 'pending':
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30';
    case 'accepted':
      return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30';
    case 'revoked':
      return 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30';
    case 'expired':
      return 'bg-[var(--surface-muted)] text-[var(--muted)] border-[var(--border)]';
  }
}

function explainError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.body && typeof err.body === 'object') {
      const b = err.body as { error?: string; message?: string };
      if (b.error === 'mfa step-up required') return 'MFA verification required. Step up in Settings, then retry.';
      if (b.error === 'duplicate') return 'An active invite already exists for this email. Revoke it first.';
      if (b.error === 'invalid-email') return 'That email address looks invalid.';
      if (b.error === 'forbidden-role') return b.message ?? 'You cannot mint an invite at that role.';
      if (b.error === 'forbidden') return b.message ?? 'You do not have permission.';
      if (b.error === 'already-final') return 'This invite is no longer pending.';
      if (b.message) return b.message;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : 'something went wrong';
}

export default function InvitationsPage() {
  const [list, setList] = useState<InvitationRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ email: string; role: MemberRole; label: string; ttlMs: number }>({
    email: '',
    role: 'member',
    label: '',
    ttlMs: TTL_PRESETS[1]!.ms,
  });
  const [submitting, setSubmitting] = useState(false);
  const [reveal, setReveal] = useState<InvitationCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.invitationsList();
      setList(data);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const base = { pending: 0, accepted: 0, revoked: 0, expired: 0 };
    for (const inv of list ?? []) base[inv.status]++;
    return base;
  }, [list]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionMessage(null);
    setSubmitting(true);
    try {
      const result = await api.invitationsCreate({
        email: form.email.trim(),
        role: form.role,
        label: form.label.trim() || null,
        ttlMs: form.ttlMs,
      });
      setReveal(result);
      setCopied(false);
      setActionMessage(`Invite created for ${result.invitation.email}.`);
      setOpen(false);
      setForm({ email: '', role: 'member', label: '', ttlMs: TTL_PRESETS[1]!.ms });
      await load();
    } catch (err) {
      setActionError(explainError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const revoke = async (inv: InvitationRecord) => {
    if (!confirm(`Revoke invite for ${inv.email}? The link will stop working immediately.`)) return;
    setBusyId(inv.id);
    setActionError(null);
    setActionMessage(null);
    try {
      await api.invitationsRevoke(inv.id);
      setActionMessage(`Revoked invite for ${inv.email}.`);
      await load();
    } catch (err) {
      setActionError(explainError(err));
    } finally {
      setBusyId(null);
    }
  };

  const copyToken = async () => {
    if (!reveal) return;
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      await navigator.clipboard.writeText(origin + reveal.acceptUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <TopNav />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl">
              <IconAt size={22} /> Invitations
            </h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Email-bound, single-use links that grant a chosen role on first login.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/settings/members"
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface)]"
            >
              <IconUsers size={16} /> Members
            </Link>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--fg)] px-3 py-1.5 text-sm font-medium text-[var(--bg)] hover:opacity-90"
            >
              <IconPlus size={16} /> New invite
            </button>
          </div>
        </header>

        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(['pending', 'accepted', 'revoked', 'expired'] as const).map((s) => (
            <div key={s} className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
              <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{s}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{counts[s]}</div>
            </div>
          ))}
        </div>

        {open && (
          <form
            onSubmit={submit}
            className="mb-6 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[var(--muted)]">Email</span>
                <input
                  type="email"
                  required
                  autoFocus
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="alice@example.com"
                  className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[var(--muted)]">Label (optional)</span>
                <input
                  type="text"
                  maxLength={200}
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="Engineering, finance, etc."
                  className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[var(--muted)]">Role</span>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as MemberRole })}
                  className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5"
                >
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <span className="text-xs text-[var(--muted)]">
                  {ROLE_OPTIONS.find((o) => o.value === form.role)?.help}
                </span>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[var(--muted)]">Expires after</span>
                <select
                  value={form.ttlMs}
                  onChange={(e) => setForm({ ...form, ttlMs: Number(e.target.value) })}
                  className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5"
                >
                  {TTL_PRESETS.map((p) => (
                    <option key={p.ms} value={p.ms}>{p.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="submit"
                disabled={submitting || !form.email.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--fg)] px-3 py-1.5 text-sm font-medium text-[var(--bg)] disabled:opacity-50"
              >
                {submitting ? <Spinner size={14} /> : <IconCheck size={14} />} Send invite
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface)]"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {reveal && (
          <div className="mb-6 rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-1.5 text-sm font-medium">
                  <IconWarning size={16} /> Copy this link now
                </h2>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  The token is shown exactly once. After you dismiss this panel only the recipient
                  can use it, by clicking the link from their inbox.
                </p>
                <code className="mt-2 block overflow-x-auto rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs">
                  {(typeof window !== 'undefined' ? window.location.origin : '') + reveal.acceptUrl}
                </code>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  Bound to <span className="font-medium text-[var(--fg)]">{reveal.invitation.email}</span>{' '}
                  as <span className="font-medium text-[var(--fg)]">{roleLabel(reveal.invitation.role)}</span>.
                  Expires {fmtRelative(reveal.invitation.expiresAt)}.
                </p>
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                <button
                  type="button"
                  onClick={copyToken}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm hover:bg-[var(--surface)]"
                >
                  <IconCopy size={14} /> {copied ? 'Copied' : 'Copy link'}
                </button>
                <button
                  type="button"
                  onClick={() => setReveal(null)}
                  className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface)]"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {actionMessage && (
          <div className="mb-4 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
            {actionMessage}
          </div>
        )}
        {actionError && (
          <div className="mb-4 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm text-rose-700 dark:text-rose-400">
            {actionError}
          </div>
        )}

        <section aria-busy={loading} className="rounded-md border border-[var(--border)] bg-[var(--surface)]">
          {loading && (
            <div className="divide-y divide-[var(--border)]">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="h-4 w-40 animate-pulse rounded bg-[var(--border)]" />
                  <div className="h-4 w-16 animate-pulse rounded bg-[var(--border)]" />
                  <div className="ml-auto h-4 w-24 animate-pulse rounded bg-[var(--border)]" />
                </div>
              ))}
            </div>
          )}
          {!loading && error && (
            <ErrorState title="Failed to load invitations" message={error} onRetry={load} />
          )}
          {!loading && !error && (list?.length ?? 0) === 0 && (
            <EmptyState
              icon={<IconAt size={28} />}
              title="No invitations yet"
              body="Create one to onboard a teammate without sharing your own credentials."
            />
          )}
          {!loading && !error && (list?.length ?? 0) > 0 && (
            <ul className="divide-y divide-[var(--border)]">
              {list!.map((inv) => (
                <li key={inv.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium" title={inv.email}>{inv.email}</span>
                      <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] uppercase tracking-wide ${statusTone(inv.status)}`}>
                        {inv.status}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-[var(--muted)]">
                        <IconShield size={11} /> {roleLabel(inv.role)}
                      </span>
                      {inv.label && (
                        <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]">
                          {inv.label}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--muted)]">
                      <span>Invited {fmtRelative(inv.createdAt)} by {inv.invitedBy}</span>
                      <span className="inline-flex items-center gap-1">
                        <IconClockCountdown size={12} />
                        {inv.status === 'pending' ? `Expires ${fmtRelative(inv.expiresAt)}` : `Expired ${fmtRelative(inv.expiresAt)}`}
                      </span>
                      {inv.acceptedAt && inv.acceptedByUserId && (
                        <span>Accepted {fmtRelative(inv.acceptedAt)} by {inv.acceptedByUserId}</span>
                      )}
                      {inv.revokedAt && inv.revokedBy && (
                        <span>Revoked {fmtRelative(inv.revokedAt)} by {inv.revokedBy}</span>
                      )}
                    </div>
                  </div>
                  {inv.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => revoke(inv)}
                      disabled={busyId === inv.id}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1 text-sm text-rose-700 hover:bg-rose-500/5 disabled:opacity-50 dark:text-rose-400"
                    >
                      {busyId === inv.id ? <Spinner size={14} /> : <IconTrash size={14} />} Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-4 text-xs text-[var(--muted)]">
          Every invite, revocation, and acceptance is recorded in the audit log with a before and after
          diff. Tokens are stored as sha256 digests, never raw. View activity in the{' '}
          <Link href="/audit" className="underline">
            audit console <IconArrowRight size={11} className="inline" />
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
