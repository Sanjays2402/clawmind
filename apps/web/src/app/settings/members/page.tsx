'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  fmtRelative,
  ApiError,
  type MemberRecord,
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
  IconArrowRight,
  IconSettings,
} from '@clawmind/ui';

const ROLE_OPTIONS: { value: MemberRole; label: string; help: string }[] = [
  { value: 'owner', label: 'Owner', help: 'Full control. Can promote or remove other owners.' },
  { value: 'admin', label: 'Admin', help: 'Manage members, keys, webhooks, retention. Cannot touch owners.' },
  { value: 'member', label: 'Member', help: 'Regular product usage with read and write access.' },
  { value: 'viewer', label: 'Viewer', help: 'Read only access.' },
];

const ROLE_RANK: Record<MemberRole, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };

function roleLabel(r: MemberRole): string {
  return ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r;
}

function explainError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401 && err.body && typeof err.body === 'object' && 'error' in err.body) {
      const b = err.body as { error?: string };
      if (b.error === 'mfa step-up required') return 'MFA verification required. Open Settings > MFA to step up, then retry.';
    }
    if (err.body && typeof err.body === 'object') {
      const b = err.body as { error?: string; message?: string };
      if (b.error === 'last-owner') return 'Cannot demote or remove the last owner. Promote another member to owner first.';
      if (b.error === 'self-remove') return 'You cannot remove your own account from members. Ask another owner to do it.';
      if (b.error === 'forbidden-target') return b.message ?? 'You do not have permission to change this member.';
      if (b.error === 'forbidden') return 'You do not have permission. Members management requires admin or owner.';
      if (b.message) return b.message;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : 'something went wrong';
}

export default function MembersPage() {
  const [members, setMembers] = useState<MemberRecord[] | null>(null);
  const [me, setMe] = useState<{ id: string; role: MemberRole | 'reader' } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState<{ userId: string; email: string; role: MemberRole }>(
    { userId: '', email: '', role: 'member' },
  );
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [whoami, list] = await Promise.all([
        fetch(`${process.env.NEXT_PUBLIC_API_BASE ?? ''}/auth/me`, { credentials: 'include' })
          .then((r) => r.json())
          .catch(() => ({ user: null })),
        api.membersList(),
      ]);
      const user = (whoami as { user?: { id: string; role: MemberRole | 'reader' } | null }).user ?? null;
      setMe(user);
      setMembers(list);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const myRole: MemberRole = useMemo(() => {
    if (!me) return 'viewer';
    return me.role === 'reader' ? 'viewer' : me.role;
  }, [me]);

  const canManage = ROLE_RANK[myRole] >= ROLE_RANK.admin;

  const setRole = async (m: MemberRecord, role: MemberRole) => {
    if (role === m.role) return;
    setBusyUser(m.userId);
    setActionError(null);
    setActionMessage(null);
    try {
      const updated = await api.membersSetRole(m.userId, role);
      setMembers((cur) => cur?.map((x) => (x.userId === m.userId ? updated : x)) ?? null);
      setActionMessage(`Updated ${m.userId} to ${roleLabel(role)}.`);
    } catch (err) {
      setActionError(explainError(err));
    } finally {
      setBusyUser(null);
    }
  };

  const remove = async (m: MemberRecord) => {
    if (!confirm(`Remove ${m.userId} from the workspace? This revokes their role.`)) return;
    setBusyUser(m.userId);
    setActionError(null);
    setActionMessage(null);
    try {
      await api.membersRemove(m.userId);
      setMembers((cur) => cur?.filter((x) => x.userId !== m.userId) ?? null);
      setActionMessage(`Removed ${m.userId}.`);
    } catch (err) {
      setActionError(explainError(err));
    } finally {
      setBusyUser(null);
    }
  };

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const result = await api.membersInvite({
        userId: inviteForm.userId.trim(),
        role: inviteForm.role,
        email: inviteForm.email.trim() || null,
      });
      setMembers((cur) => {
        if (!cur) return cur;
        const next = cur.filter((x) => x.userId !== result.member.userId);
        next.push(result.member);
        return next.sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.userId.localeCompare(b.userId));
      });
      setActionMessage(result.created ? `Invited ${result.member.userId}.` : `Updated ${result.member.userId}.`);
      setInviteOpen(false);
      setInviteForm({ userId: '', email: '', role: 'member' });
    } catch (err) {
      setActionError(explainError(err));
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Link href="/settings" className="inline-flex items-center gap-1 hover:text-foreground">
                <IconSettings size={14} /> Settings
              </Link>
              <IconArrowRight size={12} />
              <span>Members</span>
            </div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              <IconUsers size={26} /> Members
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Four-role RBAC. Owners delegate to admins, admins manage members and viewers, and every
              change is MFA stepped and written to the tamper-evident audit log.
            </p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => setInviteOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 self-start rounded-md border border-border bg-foreground px-3 py-2 text-sm font-medium text-background transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring sm:self-auto"
            >
              <IconPlus size={16} /> Invite member
            </button>
          )}
        </header>

        {inviteOpen && canManage && (
          <form
            onSubmit={submitInvite}
            className="mb-6 rounded-lg border border-border bg-card p-4 sm:p-5"
          >
            <h2 className="mb-3 text-sm font-medium">Pre-register a user</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              Enter the user id the SSO provider will issue, for example oidc:auth0|abc123. The next time
              they log in they will land in the role you choose below.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-muted-foreground">
                User id
                <input
                  required
                  value={inviteForm.userId}
                  onChange={(e) => setInviteForm({ ...inviteForm, userId: e.target.value })}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="oidc:google-oauth2|11234"
                />
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                Email (optional hint)
                <input
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="ada@example.com"
                />
              </label>
              <label className="text-xs font-medium text-muted-foreground sm:col-span-2">
                Role
                <select
                  value={inviteForm.role}
                  onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value as MemberRole })}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {ROLE_OPTIONS.filter((o) => (myRole === 'owner' ? true : o.value !== 'owner')).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  {ROLE_OPTIONS.find((o) => o.value === inviteForm.role)?.help}
                </span>
              </label>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={inviting || !inviteForm.userId.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50"
              >
                {inviting ? <Spinner size={14} /> : <IconCheck size={14} />} Invite
              </button>
              <button
                type="button"
                onClick={() => setInviteOpen(false)}
                className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {actionMessage && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
            <IconCheck size={16} /> <span>{actionMessage}</span>
          </div>
        )}
        {actionError && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <IconWarning size={16} /> <span>{actionError}</span>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-md border border-border bg-card" />
            ))}
          </div>
        ) : error ? (
          <ErrorState title="Could not load members" message={error} onRetry={load} />
        ) : !members || members.length === 0 ? (
          <EmptyState
            title="No members yet"
            body="Once a user logs in, they are auto-registered here. The first user becomes the owner."
            icon={<IconUsers size={22} />}
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Member</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Last seen</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const isSelf = me?.id === m.userId;
                  const canEdit = canManage && (myRole === 'owner' || m.role !== 'owner');
                  return (
                    <tr key={m.userId} className="border-b border-border last:border-b-0">
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium">{m.label ?? m.userId}</div>
                        <div className="text-xs text-muted-foreground">{m.userId}</div>
                        {m.email && <div className="text-xs text-muted-foreground">{m.email}</div>}
                        {isSelf && (
                          <span className="mt-1 inline-flex rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                            you
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {canEdit ? (
                          <select
                            disabled={busyUser === m.userId}
                            value={m.role}
                            onChange={(e) => setRole(m, e.target.value as MemberRole)}
                            className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            aria-label={`Role for ${m.userId}`}
                          >
                            {ROLE_OPTIONS.filter((o) => myRole === 'owner' || o.value !== 'owner').map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-1 text-xs">
                            <IconShield size={12} /> {roleLabel(m.role)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                        {m.lastSeenAt ? fmtRelative(m.lastSeenAt) : 'never (invited)'}
                      </td>
                      <td className="px-4 py-3 align-top text-right">
                        {canEdit && !isSelf ? (
                          <button
                            type="button"
                            onClick={() => remove(m)}
                            disabled={busyUser === m.userId}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
                            aria-label={`Remove ${m.userId}`}
                          >
                            {busyUser === m.userId ? <Spinner size={12} /> : <IconTrash size={12} />} Remove
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground">{isSelf ? 'self' : 'read only'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-6 text-xs text-muted-foreground">
          Every invite, role change, and removal is audit logged. Open
          {' '}
          <Link href="/audit" className="underline-offset-2 hover:underline">
            the audit trail
          </Link>{' '}
          to review. To send a one-time invitation link by email instead, use{' '}
          <Link href="/settings/invitations" className="underline-offset-2 hover:underline">
            email invitations
          </Link>.
        </p>
      </main>
    </div>
  );
}
