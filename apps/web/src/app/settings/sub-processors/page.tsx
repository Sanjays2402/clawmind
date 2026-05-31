'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  type SubProcessor,
  type SubProcessorRegistry,
} from '@/lib/api';
import {
  ErrorState,
  Spinner,
  IconArrowRight,
  IconCheck,
  IconPlus,
  IconRefresh,
  IconShield,
  IconTrash,
  IconWarning,
} from '@clawmind/ui';

// Sub-processor registry settings page. Owner-only mutations; admin+
// can view the operator console. The unauthenticated /v1/sub-processors
// JSON underlies the public DPA-citable list.

type CreateDraft = {
  name: string;
  purpose: string;
  region: string;
  website: string;
  notes: string;
};

const EMPTY_DRAFT: CreateDraft = {
  name: '',
  purpose: '',
  region: '',
  website: '',
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

export default function SubProcessorsPage() {
  const [reg, setReg] = useState<SubProcessorRegistry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [draft, setDraft] = useState<CreateDraft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);

  const [intro, setIntro] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.subProcessorsAdmin();
      setReg(r);
      setIntro(r.intro);
      setContactEmail(r.contactEmail ?? '');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Sign in required to view the sub-processor console.');
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
      const body = {
        name: draft.name.trim(),
        purpose: draft.purpose.trim(),
        region: draft.region.trim(),
        website: draft.website.trim() || null,
        notes: draft.notes.trim() || null,
      };
      await api.subProcessorsCreate(body);
      setDraft(EMPTY_DRAFT);
      setSavedAt(Date.now());
      await load();
    } catch (err) {
      setActionError(explainError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const retire = async (entry: SubProcessor) => {
    setActionError(null);
    setBusyId(entry.id);
    try {
      await api.subProcessorsRetire(entry.id);
      setSavedAt(Date.now());
      await load();
    } catch (err) {
      setActionError(explainError(err));
    } finally {
      setBusyId(null);
    }
  };

  const restore = async (entry: SubProcessor) => {
    setActionError(null);
    setBusyId(entry.id);
    try {
      await api.subProcessorsUpdate(entry.id, { status: 'active' });
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
      await api.subProcessorsSettings({
        intro,
        contactEmail: contactEmail.trim() || null,
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
    draft.region.trim().length > 0 &&
    !submitting;

  const active = reg?.entries.filter((e) => e.status === 'active') ?? [];
  const retired = reg?.entries.filter((e) => e.status === 'retired') ?? [];

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <TopNav />
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-[var(--surface-2)] p-2 text-[var(--accent)]">
              <IconShield size={22} />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-[var(--fg)]">Sub-processors</h1>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Disclosure registry referenced by your Data Processing Agreement.
                Every change is audit logged and notifies workspace members.
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Public URL:{' '}
                <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5">
                  GET /v1/sub-processors
                </code>
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
            <Spinner /> Loading registry
          </div>
        ) : error ? (
          <ErrorState title="Cannot load registry" message={error} />
        ) : (
          <div className="space-y-8">
            <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <h2 className="mb-3 text-sm font-semibold text-[var(--fg)]">Public page settings</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--muted)]">DPA contact email</span>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="dpo@example.com"
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--muted)]">
                    Last updated by
                  </span>
                  <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--muted)]">
                    {reg?.updatedBy ?? 'never'} on {fmtDate(reg?.updatedAt ?? 0)}
                  </div>
                </label>
              </div>
              <label className="mt-4 block">
                <span className="mb-1 block text-xs text-[var(--muted)]">
                  Intro shown on the public page
                </span>
                <textarea
                  value={intro}
                  onChange={(e) => setIntro(e.target.value)}
                  rows={3}
                  placeholder="ClawMind discloses the following sub-processors who may process customer data."
                  className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                />
              </label>
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
                Add a sub-processor
              </h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Legal entity name (required)"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                />
                <input
                  value={draft.region}
                  onChange={(e) => setDraft({ ...draft, region: e.target.value })}
                  placeholder="Region, e.g. us-east-1 or EU (required)"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                />
                <input
                  value={draft.purpose}
                  onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
                  placeholder="Purpose, e.g. Primary database (required)"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)] md:col-span-2"
                />
                <input
                  value={draft.website}
                  onChange={(e) => setDraft({ ...draft, website: e.target.value })}
                  placeholder="https://vendor.example/dpa (optional)"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)] md:col-span-2"
                />
                <textarea
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  rows={2}
                  placeholder="Internal notes (not shown on the public page)"
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
                  {submitting ? <Spinner /> : <IconPlus size={14} />} Disclose sub-processor
                </button>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-[var(--fg)]">
                Active ({active.length})
              </h2>
              {active.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--muted)]">
                  No active sub-processors disclosed yet. The public list will read
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
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-[var(--fg)]">{e.name}</span>
                            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-400">
                              active
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-[var(--muted)]">{e.purpose}</p>
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            Region: {e.region} · Disclosed {fmtDate(e.disclosedAt)}
                            {e.website ? (
                              <>
                                {' · '}
                                <a
                                  href={e.website}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="text-[var(--accent)] hover:underline"
                                >
                                  DPA <IconArrowRight size={10} className="inline" />
                                </a>
                              </>
                            ) : null}
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
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-[var(--fg)]">{e.name}</span>
                            <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-xs text-[var(--muted)]">
                              retired
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-[var(--muted)]">{e.purpose}</p>
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            Region: {e.region} · Disclosed {fmtDate(e.disclosedAt)} · Retired{' '}
                            {fmtDate(e.updatedAt)}
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
              Back to{' '}
              <Link href="/settings" className="text-[var(--accent)] hover:underline">
                Settings
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
