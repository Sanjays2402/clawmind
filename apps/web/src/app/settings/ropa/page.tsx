'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  type RopaActivity,
  type RopaLegalBasis,
  type RopaRegistry,
} from '@/lib/api';
import {
  ErrorState,
  Spinner,
  IconArrowRight,
  IconCheck,
  IconDatabase,
  IconPlus,
  IconRefresh,
  IconShield,
  IconTrash,
  IconWarning,
} from '@clawmind/ui';

// Record of Processing Activities (GDPR Art. 30) operator console.
// Owner-only mutations with MFA step-up; admin+ can view. The public
// JSON at GET /v1/ropa is what buyer DPOs cite from their own
// register, so internal notes never appear here on the public side.

type Draft = {
  name: string;
  purpose: string;
  legalBasis: RopaLegalBasis;
  dataCategories: string;
  dataSubjects: string;
  storageRegion: string;
  retention: string;
  recipients: string;
  transferMechanism: string;
  notes: string;
};

const EMPTY_DRAFT: Draft = {
  name: '',
  purpose: '',
  legalBasis: 'contract',
  dataCategories: '',
  dataSubjects: '',
  storageRegion: '',
  retention: '',
  recipients: '',
  transferMechanism: '',
  notes: '',
};

const BASIS_OPTIONS: { value: RopaLegalBasis; label: string }[] = [
  { value: 'consent', label: 'Consent (Art. 6(1)(a))' },
  { value: 'contract', label: 'Contract (Art. 6(1)(b))' },
  { value: 'legal_obligation', label: 'Legal obligation (Art. 6(1)(c))' },
  { value: 'vital_interests', label: 'Vital interests (Art. 6(1)(d))' },
  { value: 'public_task', label: 'Public task (Art. 6(1)(e))' },
  { value: 'legitimate_interests', label: 'Legitimate interests (Art. 6(1)(f))' },
];

function fmtDate(ts: number): string {
  if (!ts) return 'never';
  try {
    return new Date(ts).toISOString().slice(0, 10);
  } catch {
    return 'unknown';
  }
}

function basisLabel(b: RopaLegalBasis): string {
  return BASIS_OPTIONS.find((o) => o.value === b)?.label ?? b;
}

export default function RopaPage() {
  const [reg, setReg] = useState<RopaRegistry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);

  const [intro, setIntro] = useState('');
  const [controllerContact, setControllerContact] = useState('');
  const [dpoName, setDpoName] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.ropaAdmin();
      setReg(r);
      setIntro(r.intro);
      setControllerContact(r.controllerContact ?? '');
      setDpoName(r.dpoName ?? '');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Sign in required to view the processing activities console.');
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

  const submitCreate = async () => {
    setActionError(null);
    setSubmitting(true);
    try {
      await api.ropaCreate({
        name: draft.name.trim(),
        purpose: draft.purpose.trim(),
        legalBasis: draft.legalBasis,
        dataCategories: draft.dataCategories.trim(),
        dataSubjects: draft.dataSubjects.trim(),
        storageRegion: draft.storageRegion.trim(),
        retention: draft.retention.trim(),
        recipients: draft.recipients.trim() || null,
        transferMechanism: draft.transferMechanism.trim() || null,
        notes: draft.notes.trim() || null,
      });
      setDraft(EMPTY_DRAFT);
      setSavedAt(Date.now());
      await load();
    } catch (err) {
      setActionError(explainError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const retire = async (entry: RopaActivity) => {
    setActionError(null);
    setBusyId(entry.id);
    try {
      await api.ropaRetire(entry.id);
      setSavedAt(Date.now());
      await load();
    } catch (err) {
      setActionError(explainError(err));
    } finally {
      setBusyId(null);
    }
  };

  const restore = async (entry: RopaActivity) => {
    setActionError(null);
    setBusyId(entry.id);
    try {
      await api.ropaUpdate(entry.id, { status: 'active' });
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
      await api.ropaSettings({
        intro,
        controllerContact: controllerContact.trim() || null,
        dpoName: dpoName.trim() || null,
      });
      setSavedAt(Date.now());
      await load();
    } catch (err) {
      setActionError(explainError(err));
    } finally {
      setSavingSettings(false);
    }
  };

  const canSubmit =
    draft.name.trim().length > 0 &&
    draft.purpose.trim().length > 0 &&
    draft.dataCategories.trim().length > 0 &&
    draft.dataSubjects.trim().length > 0 &&
    draft.storageRegion.trim().length > 0 &&
    draft.retention.trim().length > 0 &&
    !submitting;

  const active = reg?.entries.filter((e) => e.status === 'active') ?? [];
  const retired = reg?.entries.filter((e) => e.status === 'retired') ?? [];

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <TopNav />
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-[var(--surface-2)] p-2 text-[var(--accent)]">
              <IconShield size={22} />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-[var(--fg)]">
                Record of Processing Activities
              </h1>
              <p className="mt-1 text-sm text-[var(--muted)]">
                GDPR Article 30 register of processing activities. Every change is audit
                logged, requires owner role plus MFA, and broadcasts an in-app notice to
                every workspace member.
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Public URL:{' '}
                <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5">
                  GET /v1/ropa
                </code>{' '}
                (no auth, safe for a buyer DPO to cite from their own register)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--fg)] hover:bg-[var(--surface-2)]"
          >
            <IconRefresh size={14} /> Refresh
          </button>
        </div>

        {savedAt && (
          <div className="mb-4 inline-flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-400">
            <IconCheck size={14} /> Saved {new Date(savedAt).toLocaleTimeString()}
          </div>
        )}
        {actionError && (
          <div className="mb-4 inline-flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-400">
            <IconWarning size={14} /> {actionError}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <Spinner /> Loading register
          </div>
        ) : error ? (
          <ErrorState title="Cannot load register" message={error} />
        ) : (
          <div className="space-y-8">
            <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <h2 className="mb-3 text-sm font-semibold text-[var(--fg)]">
                Public page settings
              </h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--muted)]">
                    Controller contact email
                  </span>
                  <input
                    type="email"
                    value={controllerContact}
                    onChange={(e) => setControllerContact(e.target.value)}
                    placeholder="dpo@example.com"
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--muted)]">
                    Data Protection Officer
                  </span>
                  <input
                    type="text"
                    value={dpoName}
                    onChange={(e) => setDpoName(e.target.value)}
                    placeholder="Jane Roe (optional)"
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                  />
                </label>
              </div>
              <label className="mt-4 block">
                <span className="mb-1 block text-xs text-[var(--muted)]">
                  Intro shown on the public register
                </span>
                <textarea
                  value={intro}
                  onChange={(e) => setIntro(e.target.value)}
                  rows={3}
                  placeholder="ClawMind maintains the following register of processing activities under GDPR Article 30."
                  className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                />
              </label>
              <p className="mt-2 text-xs text-[var(--muted)]">
                Last updated by {reg?.updatedBy ?? 'never'} on {fmtDate(reg?.updatedAt ?? 0)}.
              </p>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => void saveSettings()}
                  disabled={savingSettings}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {savingSettings ? <Spinner /> : <IconCheck size={14} />} Save settings
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <h2 className="mb-3 text-sm font-semibold text-[var(--fg)]">
                Add a processing activity
              </h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Activity name, e.g. Customer notes ingest (required)"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)] md:col-span-2"
                />
                <input
                  value={draft.purpose}
                  onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
                  placeholder="Purpose, e.g. Index notes for retrieval (required)"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)] md:col-span-2"
                />
                <label className="block md:col-span-2">
                  <span className="mb-1 block text-xs text-[var(--muted)]">Legal basis</span>
                  <select
                    value={draft.legalBasis}
                    onChange={(e) =>
                      setDraft({ ...draft, legalBasis: e.target.value as RopaLegalBasis })
                    }
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                  >
                    {BASIS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <input
                  value={draft.dataCategories}
                  onChange={(e) => setDraft({ ...draft, dataCategories: e.target.value })}
                  placeholder="Data categories, e.g. note text, embeddings (required)"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                />
                <input
                  value={draft.dataSubjects}
                  onChange={(e) => setDraft({ ...draft, dataSubjects: e.target.value })}
                  placeholder="Data subjects, e.g. workspace members (required)"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                />
                <input
                  value={draft.storageRegion}
                  onChange={(e) => setDraft({ ...draft, storageRegion: e.target.value })}
                  placeholder="Storage region, e.g. us-east-1 (required)"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                />
                <input
                  value={draft.retention}
                  onChange={(e) => setDraft({ ...draft, retention: e.target.value })}
                  placeholder="Retention, e.g. 90 days then erased (required)"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                />
                <input
                  value={draft.recipients}
                  onChange={(e) => setDraft({ ...draft, recipients: e.target.value })}
                  placeholder="Recipients, e.g. OpenAI for embeddings (optional)"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)] md:col-span-2"
                />
                <input
                  value={draft.transferMechanism}
                  onChange={(e) => setDraft({ ...draft, transferMechanism: e.target.value })}
                  placeholder="Transfer mechanism for non-EEA recipients, e.g. SCCs (optional)"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)] md:col-span-2"
                />
                <textarea
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  rows={2}
                  placeholder="Internal notes (not shown on the public register)"
                  className="resize-y rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)] md:col-span-2"
                />
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => void submitCreate()}
                  disabled={!canSubmit}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {submitting ? <Spinner /> : <IconPlus size={14} />} Disclose activity
                </button>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-[var(--fg)]">
                Active ({active.length})
              </h2>
              {active.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--muted)]">
                  <IconDatabase size={20} className="mx-auto mb-2 opacity-60" />
                  No processing activities disclosed yet. The public register will read
                  &ldquo;none disclosed&rdquo; until you add one.
                </div>
              ) : (
                <ul className="space-y-2">
                  {active.map((e) => (
                    <li
                      key={e.id}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-[var(--fg)]">
                              {e.name}
                            </span>
                            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-400">
                              active
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-[var(--muted)]">{e.purpose}</p>
                          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-[var(--muted)] sm:grid-cols-2">
                            <div>
                              <dt className="inline text-[var(--fg)]">Basis:</dt>{' '}
                              {basisLabel(e.legalBasis)}
                            </div>
                            <div>
                              <dt className="inline text-[var(--fg)]">Region:</dt>{' '}
                              {e.storageRegion}
                            </div>
                            <div>
                              <dt className="inline text-[var(--fg)]">Subjects:</dt>{' '}
                              {e.dataSubjects}
                            </div>
                            <div>
                              <dt className="inline text-[var(--fg)]">Categories:</dt>{' '}
                              {e.dataCategories}
                            </div>
                            <div>
                              <dt className="inline text-[var(--fg)]">Retention:</dt>{' '}
                              {e.retention}
                            </div>
                            {e.recipients && (
                              <div>
                                <dt className="inline text-[var(--fg)]">Recipients:</dt>{' '}
                                {e.recipients}
                              </div>
                            )}
                            {e.transferMechanism && (
                              <div className="sm:col-span-2">
                                <dt className="inline text-[var(--fg)]">Transfer:</dt>{' '}
                                {e.transferMechanism}
                              </div>
                            )}
                          </dl>
                          <p className="mt-2 text-xs text-[var(--muted)]">
                            Disclosed {fmtDate(e.disclosedAt)} · Updated {fmtDate(e.updatedAt)}
                          </p>
                          {e.notes && (
                            <p className="mt-2 rounded bg-[var(--surface-2)] px-2 py-1 text-xs text-[var(--muted)]">
                              {e.notes}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => void retire(e)}
                          disabled={busyId === e.id}
                          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--fg)] hover:bg-[var(--surface-2)] disabled:opacity-50"
                        >
                          {busyId === e.id ? <Spinner /> : <IconTrash size={12} />} Retire
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {retired.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-semibold text-[var(--fg)]">
                  Retired ({retired.length})
                </h2>
                <ul className="space-y-2">
                  {retired.map((e) => (
                    <li
                      key={e.id}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 opacity-80"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-[var(--fg)]">
                              {e.name}
                            </span>
                            <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-xs text-[var(--muted)]">
                              retired
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-[var(--muted)]">{e.purpose}</p>
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            Basis: {basisLabel(e.legalBasis)} · Region: {e.storageRegion} ·
                            Disclosed {fmtDate(e.disclosedAt)} · Retired {fmtDate(e.updatedAt)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void restore(e)}
                          disabled={busyId === e.id}
                          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--fg)] hover:bg-[var(--surface-2)] disabled:opacity-50"
                        >
                          {busyId === e.id ? <Spinner /> : <IconRefresh size={12} />} Restore
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="text-xs text-[var(--muted)]">
              View the public register at{' '}
              <Link
                href="/v1/ropa"
                className="text-[var(--accent)] hover:underline"
              >
                /v1/ropa <IconArrowRight size={10} className="inline" />
              </Link>{' '}
              or go back to{' '}
              <Link href="/settings" className="text-[var(--accent)] hover:underline">
                Settings
              </Link>
              .
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
