'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  type RecoveryContact,
  type RecoveryContactRegistry,
} from '@/lib/api';
import {
  ErrorState,
  SettingsCardSkeleton,
  Spinner,
  IconArrowRight,
  IconCheck,
  IconPlus,
  IconRefresh,
  IconShield,
  IconTrash,
  IconUsers,
  IconWarning,
} from '@clawmind/ui';

// Recovery contacts settings (SOC2 CC7.4 / BCP escalation list).
// Owner-only mutations with MFA step-up at the API; admin+ may view
// the operator console. The public projection at /v1/recovery-contacts
// is unauthenticated so buyers' incident-response runbooks can cite it.

// Shared control styling: theme-aware surface + brand focus ring.
const INPUT_CLS =
  'w-full rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm text-cm-fg outline-none placeholder:text-cm-faint focus:ring-2 focus:ring-cm-accent';

type CreateDraft = {
  name: string;
  role: string;
  email: string;
  phone: string;
  priority: string;
  publicListed: boolean;
  notes: string;
};

const EMPTY_DRAFT: CreateDraft = {
  name: '',
  role: '',
  email: '',
  phone: '',
  priority: '100',
  publicListed: false,
  notes: '',
};

function fmtDate(ts: number): string {
  if (!ts) return 'never';
  try {
    return new Date(ts).toISOString().slice(0, 10);
  } catch {
    return 'unknown';
  }
}

function explainError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Sign in required.';
    if (err.status === 403) return 'Owner role required.';
    if (err.status === 412) return 'MFA step-up required. Verify a TOTP code and try again.';
    if (err.status === 423) return 'Workspace is frozen.';
    return err.message;
  }
  return (err as Error).message;
}

export default function RecoveryContactsPage() {
  const [reg, setReg] = useState<RecoveryContactRegistry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [draft, setDraft] = useState<CreateDraft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);

  const [intro, setIntro] = useState('');
  const [fallbackEmail, setFallbackEmail] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.recoveryContactsAdmin();
      setReg(r);
      setIntro(r.intro);
      setFallbackEmail(r.fallbackEmail ?? '');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Sign in required to view the recovery contacts console.');
      } else if (err instanceof ApiError && err.status === 403) {
        setError('Only workspace admins can view the operator console.');
      } else {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitCreate = async () => {
    setActionError(null);
    setSubmitting(true);
    try {
      const priorityNum = Number(draft.priority);
      if (!Number.isFinite(priorityNum) || priorityNum < 1 || priorityNum > 999) {
        throw new Error('priority must be a whole number between 1 and 999');
      }
      const body = {
        name: draft.name.trim(),
        role: draft.role.trim(),
        email: draft.email.trim(),
        phone: draft.phone.trim() || null,
        priority: Math.trunc(priorityNum),
        publicListed: draft.publicListed,
        notes: draft.notes.trim() || null,
      };
      await api.recoveryContactsCreate(body);
      setDraft(EMPTY_DRAFT);
      setSavedAt(Date.now());
      await load();
    } catch (err) {
      setActionError(explainError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const togglePublic = async (entry: RecoveryContact) => {
    setActionError(null);
    setBusyId(entry.id);
    try {
      await api.recoveryContactsUpdate(entry.id, { publicListed: !entry.publicListed });
      setSavedAt(Date.now());
      await load();
    } catch (err) {
      setActionError(explainError(err));
    } finally {
      setBusyId(null);
    }
  };

  const retire = async (entry: RecoveryContact) => {
    setActionError(null);
    setBusyId(entry.id);
    try {
      await api.recoveryContactsRetire(entry.id);
      setSavedAt(Date.now());
      await load();
    } catch (err) {
      setActionError(explainError(err));
    } finally {
      setBusyId(null);
    }
  };

  const restore = async (entry: RecoveryContact) => {
    setActionError(null);
    setBusyId(entry.id);
    try {
      await api.recoveryContactsUpdate(entry.id, { status: 'active' });
      setSavedAt(Date.now());
      await load();
    } catch (err) {
      setActionError(explainError(err));
    } finally {
      setBusyId(null);
    }
  };

  const saveSettings = async () => {
    setActionError(null);
    setSavingSettings(true);
    try {
      await api.recoveryContactsSettings({
        intro: intro,
        fallbackEmail: fallbackEmail.trim() || null,
      });
      setSavedAt(Date.now());
      await load();
    } catch (err) {
      setActionError(explainError(err));
    } finally {
      setSavingSettings(false);
    }
  };

  // Public escalation coverage: the unauthenticated /v1/recovery-contacts
  // projection only emits ACTIVE + publicListed entries. If none are public,
  // a buyer's incident-response runbook has nothing to route to except the
  // fallback email - so we surface that gap explicitly instead of letting it
  // hide behind a populated-looking operator console.
  const publicCount = useMemo(
    () => reg?.entries.filter((e) => e.status === 'active' && e.publicListed).length ?? 0,
    [reg],
  );
  const activeCount = useMemo(
    () => reg?.entries.filter((e) => e.status === 'active').length ?? 0,
    [reg],
  );
  const hasFallback = (reg?.fallbackEmail ?? '').trim().length > 0;

  return (
    <div className="min-h-dvh bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-cm-muted">
              <Link href="/settings" className="hover:text-cm-fg hover:underline">
                Settings
              </Link>
              <IconArrowRight size={12} />
              <span>Recovery contacts</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              Recovery contacts
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-cm-muted">
              Named escalation channels for the workspace. Buyer incident-response
              runbooks cite the public list at{' '}
              <code className="rounded bg-cm-subtle px-1 py-0.5 text-xs">
                /v1/recovery-contacts
              </code>
              . Owner role plus MFA step-up is required to change this list.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-md border border-cm-border px-3 py-1.5 text-sm hover:bg-cm-subtle disabled:opacity-50"
            disabled={loading}
            aria-label="Reload"
          >
            <IconRefresh size={14} />
            <span className="hidden sm:inline">Reload</span>
          </button>
        </header>

        {savedAt && (
          <div className="mb-4 inline-flex items-center gap-2 rounded-md border border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] px-3 py-1.5 text-xs text-cm-success">
            <IconCheck size={12} /> Saved
          </div>
        )}
        {actionError && (
          <div className="mb-4 rounded-md border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] px-3 py-2 text-sm text-cm-danger">
            {actionError}
          </div>
        )}

        {loading ? (
          <SettingsCardSkeleton rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : reg ? (
          <div className="space-y-8">
            {/* Public escalation coverage posture. */}
            {publicCount > 0 ? (
              <div className="flex items-start gap-2 rounded-md border border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] p-3 text-xs text-cm-success">
                <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {publicCount} of {activeCount} active{' '}
                  {activeCount === 1 ? 'contact is' : 'contacts are'} on the public list. A buyer&apos;s
                  runbook can route to a named human via{' '}
                  <code className="rounded bg-cm-paper px-1 py-0.5">/v1/recovery-contacts</code>.
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-cm-cite-line bg-cm-cite-bg p-3 text-xs text-cm-cite">
                <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  No contact is public-listed, so the public escalation page is empty.
                  {hasFallback
                    ? ' Buyers fall back to the fallback email only - mark at least one contact public for a named path.'
                    : ' With no fallback email set either, a buyer runbook has nowhere to route. Add a contact and list it publicly, or set a fallback email below.'}
                </span>
              </div>
            )}

            {/* Settings */}
            <section className="rounded-lg border border-cm-border bg-cm-paper p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <IconShield size={16} /> Public page settings
              </h2>
              <p className="mt-1 text-xs text-cm-muted">
                Both fields appear on the unauthenticated public list.
              </p>
              <div className="mt-4 grid gap-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-xs font-medium text-cm-muted">
                    Intro
                  </span>
                  <textarea
                    value={intro}
                    onChange={(e) => setIntro(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder="Escalation list for business-continuity events..."
                    className={`${INPUT_CLS} resize-y`}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-xs font-medium text-cm-muted">
                    Fallback email
                  </span>
                  <input
                    type="email"
                    value={fallbackEmail}
                    onChange={(e) => setFallbackEmail(e.target.value)}
                    maxLength={320}
                    placeholder="security@example.com"
                    className={INPUT_CLS}
                  />
                </label>
                <div>
                  <button
                    type="button"
                    onClick={() => void saveSettings()}
                    disabled={savingSettings}
                    className="inline-flex items-center gap-2 rounded-md bg-cm-fg px-3 py-1.5 text-sm font-medium text-cm-bg hover:opacity-90 disabled:opacity-50"
                  >
                    {savingSettings ? <Spinner /> : <IconCheck size={14} />}
                    Save settings
                  </button>
                </div>
              </div>
            </section>

            {/* Add contact */}
            <section className="rounded-lg border border-cm-border bg-cm-paper p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <IconPlus size={16} /> Add a contact
              </h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block text-sm sm:col-span-1">
                  <span className="mb-1 block text-xs font-medium text-cm-muted">
                    Name
                  </span>
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    maxLength={200}
                    className={INPUT_CLS}
                  />
                </label>
                <label className="block text-sm sm:col-span-1">
                  <span className="mb-1 block text-xs font-medium text-cm-muted">
                    Role
                  </span>
                  <input
                    value={draft.role}
                    onChange={(e) => setDraft({ ...draft, role: e.target.value })}
                    maxLength={120}
                    placeholder="DPO, Security Lead, On-call SRE"
                    className={INPUT_CLS}
                  />
                </label>
                <label className="block text-sm sm:col-span-1">
                  <span className="mb-1 block text-xs font-medium text-cm-muted">
                    Email
                  </span>
                  <input
                    type="email"
                    value={draft.email}
                    onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                    maxLength={320}
                    className={INPUT_CLS}
                  />
                </label>
                <label className="block text-sm sm:col-span-1">
                  <span className="mb-1 block text-xs font-medium text-cm-muted">
                    Phone (optional)
                  </span>
                  <input
                    value={draft.phone}
                    onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                    maxLength={60}
                    className={INPUT_CLS}
                  />
                </label>
                <label className="block text-sm sm:col-span-1">
                  <span className="mb-1 block text-xs font-medium text-cm-muted">
                    Priority (1 = first)
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={draft.priority}
                    onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
                    className={INPUT_CLS}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm sm:col-span-1 sm:pt-6">
                  <input
                    type="checkbox"
                    checked={draft.publicListed}
                    onChange={(e) =>
                      setDraft({ ...draft, publicListed: e.target.checked })
                    }
                    className="h-4 w-4 accent-cm-accent"
                  />
                  <span>List on the public page</span>
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1 block text-xs font-medium text-cm-muted">
                    Operator notes (never published)
                  </span>
                  <textarea
                    value={draft.notes}
                    onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    rows={2}
                    maxLength={1000}
                    placeholder="After-hours: use Signal."
                    className={`${INPUT_CLS} resize-y`}
                  />
                </label>
              </div>
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => void submitCreate()}
                  disabled={
                    submitting ||
                    !draft.name.trim() ||
                    !draft.role.trim() ||
                    !draft.email.trim()
                  }
                  className="inline-flex items-center gap-2 rounded-md bg-cm-fg px-3 py-1.5 text-sm font-medium text-cm-bg hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? <Spinner /> : <IconPlus size={14} />}
                  Add contact
                </button>
              </div>
            </section>

            {/* Existing entries */}
            <section className="rounded-lg border border-cm-border bg-cm-paper p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <IconUsers size={16} /> Contacts ({reg.entries.length})
              </h2>
              {reg.entries.length === 0 ? (
                <p className="mt-4 text-sm text-cm-muted">
                  No contacts yet. Add at least one so a buyer&apos;s
                  incident-response runbook has a routable escalation path.
                </p>
              ) : (
                <ul className="mt-4 divide-y divide-cm-border">
                  {[...reg.entries]
                    .sort(
                      (a, b) =>
                        (a.status === 'retired' ? 1 : 0) -
                          (b.status === 'retired' ? 1 : 0) ||
                        a.priority - b.priority ||
                        a.name.localeCompare(b.name),
                    )
                    .map((e) => {
                      const retired = e.status === 'retired';
                      return (
                        <li
                          key={e.id}
                          className={[
                            'flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between',
                            retired ? 'opacity-60' : '',
                          ].join(' ')}
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{e.name}</span>
                              <span className="rounded bg-cm-subtle px-1.5 py-0.5 text-xs text-cm-muted">
                                P{e.priority}
                              </span>
                              <span className="text-xs text-cm-muted">
                                {e.role}
                              </span>
                              {e.publicListed && e.status === 'active' && (
                                <span className="inline-flex items-center gap-1 rounded border border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] px-1.5 py-0.5 text-xs text-cm-success">
                                  <IconCheck size={10} /> public
                                </span>
                              )}
                              {retired && (
                                <span className="rounded border border-cm-cite-line bg-cm-cite-bg px-1.5 py-0.5 text-xs text-cm-cite">
                                  retired
                                </span>
                              )}
                            </div>
                            <div className="mt-1 break-words text-xs text-cm-muted">
                              {e.email}
                              {e.phone ? ` · ${e.phone}` : ''} · updated{' '}
                              {fmtDate(e.updatedAt)}
                            </div>
                            {e.notes && (
                              <p className="mt-1 text-xs text-cm-muted">
                                {e.notes}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-shrink-0 gap-2">
                            {e.status === 'active' ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void togglePublic(e)}
                                  disabled={busyId === e.id}
                                  className="rounded-md border border-cm-border px-2 py-1 text-xs hover:bg-cm-subtle disabled:opacity-50"
                                >
                                  {e.publicListed ? 'Make private' : 'Make public'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void retire(e)}
                                  disabled={busyId === e.id}
                                  className="inline-flex items-center gap-1 rounded-md border border-[var(--cm-danger)] px-2 py-1 text-xs text-cm-danger hover:bg-[rgba(180,66,60,0.10)] disabled:opacity-50"
                                >
                                  <IconTrash size={12} /> Retire
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void restore(e)}
                                disabled={busyId === e.id}
                                className="rounded-md border border-cm-border px-2 py-1 text-xs hover:bg-cm-subtle disabled:opacity-50"
                              >
                                Restore
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                </ul>
              )}
            </section>

            <p className="text-xs text-cm-muted">
              Last updated {fmtDate(reg.updatedAt)}
              {reg.updatedBy ? ` by ${reg.updatedBy}` : ''}.
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
