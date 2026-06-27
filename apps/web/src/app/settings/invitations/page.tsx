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

// Status chips route through the brand feedback inks so include/exclude-style
// state reads at a glance on the warm paper-cream surface: pending uses the
// citation gold (the app's caution ink), accepted uses --cm-success, revoked
// uses --cm-danger, each with a 10% tint fill; expired is a calm neutral.
function statusTone(status: InvitationRecord['status']): string {
  switch (status) {
    case 'pending':
      return 'border-[var(--cm-cite-line)] bg-[var(--cm-cite-bg)] text-[var(--cm-cite)]';
    case 'accepted':
      return 'border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] text-[var(--cm-success)]';
    case 'revoked':
      return 'border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] text-[var(--cm-danger)]';
    case 'expired':
      return 'border-[var(--cm-border)] bg-[var(--cm-subtle)] text-[var(--cm-muted)]';
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
    <div className="min-h-screen bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl">
              <IconAt size={22} /> Invitations
            </h1>
            <p className="mt-1 text-sm text-cm-muted">
              Email-bound, single-use links that grant a chosen role on first login.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/settings/members"
              className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm hover:bg-cm-subtle"
            >
              <IconUsers size={16} /> Members
            </Link>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md bg-cm-fg px-3 py-1.5 text-sm font-medium text-cm-bg hover:opacity-90"
            >
              <IconPlus size={16} /> New invite
            </button>
          </div>
        </header>

        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(['pending', 'accepted', 'revoked', 'expired'] as const).map((s) => (
            <div key={s} className="rounded-md border border-cm-border bg-cm-paper px-3 py-2.5">
              <div className="text-[11px] uppercase tracking-wide text-cm-muted">{s}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{counts[s]}</div>
            </div>
          ))}
        </div>

        {open && (
          <form
            onSubmit={submit}
            className="mb-6 rounded-md border border-cm-border bg-cm-paper p-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-cm-muted">Email</span>
                <input
                  type="email"
                  required
                  autoFocus
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="alice@example.com"
                  className="rounded-md border border-cm-border bg-cm-bg px-2.5 py-1.5 outline-none focus:border-cm-border-strong"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-cm-muted">Label (optional)</span>
                <input
                  type="text"
                  maxLength={200}
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="Engineering, finance, etc."
                  className="rounded-md border border-cm-border bg-cm-bg px-2.5 py-1.5 outline-none focus:border-cm-border-strong"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-cm-muted">Role</span>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as MemberRole })}
                  className="rounded-md border border-cm-border bg-cm-bg px-2.5 py-1.5 outline-none focus:border-cm-border-strong"
                >
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <span className="text-xs text-cm-muted">
                  {ROLE_OPTIONS.find((o) => o.value === form.role)?.help}
                </span>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-cm-muted">Expires after</span>
                <select
                  value={form.ttlMs}
                  onChange={(e) => setForm({ ...form, ttlMs: Number(e.target.value) })}
                  className="rounded-md border border-cm-border bg-cm-bg px-2.5 py-1.5 outline-none focus:border-cm-border-strong"
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
                className="inline-flex items-center gap-1.5 rounded-md bg-cm-fg px-3 py-1.5 text-sm font-medium text-cm-bg hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? <Spinner size={14} /> : <IconCheck size={14} />} Send invite
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-cm-border px-3 py-1.5 text-sm hover:bg-cm-subtle"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {reveal && (
          <div className="mb-6 rounded-md border border-[var(--cm-cite-line)] bg-[var(--cm-cite-bg)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-1.5 text-sm font-medium text-[var(--cm-cite)]">
                  <IconWarning size={16} /> Copy this link now
                </h2>
                <p className="mt-1 text-xs text-cm-muted">
                  The token is shown exactly once. After you dismiss this panel only the recipient
                  can use it, by clicking the link from their inbox.
                </p>
                <code className="cm-mono mt-2 block overflow-x-auto rounded border border-cm-border bg-cm-bg px-2 py-1.5 text-xs">
                  {(typeof window !== 'undefined' ? window.location.origin : '') + reveal.acceptUrl}
                </code>
                <p className="mt-2 text-xs text-cm-muted">
                  Bound to <span className="font-medium text-cm-fg">{reveal.invitation.email}</span>{' '}
                  as <span className="font-medium text-cm-fg">{roleLabel(reveal.invitation.role)}</span>.
                  Expires {fmtRelative(reveal.invitation.expiresAt)}.
                </p>
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                <button
                  type="button"
                  onClick={copyToken}
                  className="inline-flex items-center gap-1.5 rounded-md border border-cm-border bg-cm-bg px-3 py-1.5 text-sm hover:bg-cm-subtle"
                >
                  <IconCopy size={14} /> {copied ? 'Copied' : 'Copy link'}
                </button>
                <button
                  type="button"
                  onClick={() => setReveal(null)}
                  className="rounded-md border border-cm-border px-3 py-1.5 text-sm hover:bg-cm-subtle"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {actionMessage && (
          <div className="mb-4 rounded-md border border-[var(--cm-success)] bg-[rgba(47,122,85,0.08)] px-3 py-2 text-sm text-[var(--cm-success)]">
            {actionMessage}
          </div>
        )}
        {actionError && (
          <div className="mb-4 rounded-md border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.08)] px-3 py-2 text-sm text-[var(--cm-danger)]">
            {actionError}
          </div>
        )}

        <section aria-busy={loading} className="rounded-md border border-cm-border bg-cm-paper">
          {loading && (
            <div className="divide-y divide-cm-border">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="h-4 w-40 animate-pulse rounded bg-cm-subtle" />
                  <div className="h-4 w-16 animate-pulse rounded bg-cm-subtle" />
                  <div className="ml-auto h-4 w-24 animate-pulse rounded bg-cm-subtle" />
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
            <ul className="divide-y divide-cm-border">
              {list!.map((inv) => (
                <li key={inv.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium" title={inv.email}>{inv.email}</span>
                      <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] uppercase tracking-wide ${statusTone(inv.status)}`}>
                        {inv.status}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded border border-cm-border px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-cm-muted">
                        <IconShield size={11} /> {roleLabel(inv.role)}
                      </span>
                      {inv.label && (
                        <span className="rounded border border-cm-border px-1.5 py-0.5 text-[11px] text-cm-muted">
                          {inv.label}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-cm-muted">
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
                      className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2.5 py-1 text-sm text-[var(--cm-danger)] hover:bg-[rgba(180,66,60,0.08)] disabled:opacity-50"
                    >
                      {busyId === inv.id ? <Spinner size={14} /> : <IconTrash size={14} />} Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-4 text-xs text-cm-muted">
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
