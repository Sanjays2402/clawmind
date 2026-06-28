'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  type ModelAllowlistPolicy,
  type ModelAllowlistRule,
  type ModelAllowlistMode,
  ApiError,
} from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  SettingsCardSkeleton,
  Spinner,
  IconArrowRight,
  IconPlus,
  IconRefresh,
  IconShield,
  IconTrash,
  IconWarning,
} from '@clawmind/ui';

// Shared input styling: theme-aware surface + brand focus ring.
const INPUT_CLS =
  'flex-1 rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm text-cm-fg outline-none placeholder:text-cm-faint focus:ring-2 focus:ring-cm-accent';

function fmtDate(ts: number): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

const MODE_LABEL: Record<ModelAllowlistMode, string> = {
  disabled: 'Disabled',
  allow: 'Allow listed only',
  block: 'Block listed',
};

const MODE_HINT: Record<ModelAllowlistMode, string> = {
  disabled: 'Every model is accepted. No enforcement at /v1/ask or /v1/ask/stream.',
  allow:
    'Only the models listed below may serve answers. Any other model returns 422 model-not-allowed.',
  block:
    'Every model is accepted except the ones listed below. Useful for retiring a deprecated provider without breaking the default path.',
};

export default function ModelAllowlistPage() {
  const [policy, setPolicy] = useState<ModelAllowlistPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [model, setModel] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await api.modelAllowlistGet();
      setPolicy(p);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You do not have permission to view the workspace model allowlist.');
      } else if (err instanceof ApiError && err.status === 401) {
        setError('Sign in to view the workspace model allowlist.');
      } else {
        setError(err instanceof Error ? err.message : 'failed to load');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onModeChange(next: ModelAllowlistMode) {
    if (!policy || next === policy.mode) return;
    setSavingMode(true);
    setActionError(null);
    try {
      const p = await api.modelAllowlistSetMode(next);
      setPolicy(p);
      setSavedAt(Date.now());
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setActionError('Only workspace owners with active MFA may change the mode.');
      } else {
        setActionError(err instanceof Error ? err.message : 'failed');
      }
    } finally {
      setSavingMode(false);
    }
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = model.trim();
    if (!trimmed) return;
    setSaving(true);
    setActionError(null);
    try {
      await api.modelAllowlistAdd({
        model: trimmed,
        label: label.trim() === '' ? null : label.trim(),
      });
      setModel('');
      setLabel('');
      setSavedAt(Date.now());
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setActionError('Only workspace owners with active MFA may add models.');
      } else if (err instanceof ApiError && err.status === 400) {
        setActionError(
          (err.body as { message?: string } | undefined)?.message ?? 'invalid model',
        );
      } else {
        setActionError(err instanceof Error ? err.message : 'failed');
      }
    } finally {
      setSaving(false);
    }
  }

  async function onRemove(id: string) {
    setRemovingId(id);
    setActionError(null);
    try {
      await api.modelAllowlistRemove(id);
      setSavedAt(Date.now());
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setActionError('Only workspace owners with active MFA may remove models.');
      } else {
        setActionError(err instanceof Error ? err.message : 'failed');
      }
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-6 flex items-center gap-2 text-sm text-cm-muted">
          <Link href="/settings" className="hover:text-cm-fg">
            Settings
          </Link>
          <IconArrowRight className="h-3.5 w-3.5" />
          <span className="text-cm-fg">Model allowlist</span>
        </div>

        <header className="mb-8">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-md border border-cm-border bg-cm-subtle p-1.5 text-cm-accent">
              <IconShield className="h-4 w-4" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">Model allowlist</h1>
          </div>
          <p className="text-sm text-cm-muted">
            Control which LLM model identifiers may serve answers in this workspace. Enforced
            after the LLM returns its model tag on /v1/ask and before the SSE stream opens on
            /v1/ask/stream. A denied model is rejected with 422 model-not-allowed and an audit
            entry is written. Owner only, MFA required.
          </p>
        </header>

        {loading && <SettingsCardSkeleton rows={3} />}

        {error && !loading && <ErrorState title="Could not load policy" message={error} />}

        {!loading && !error && policy && (
          <>
            <section className="mb-8 rounded-lg border border-cm-border bg-cm-paper p-5">
              <h2 className="mb-3 text-sm font-medium text-cm-fg">Mode</h2>
              <div className="flex flex-col gap-2 sm:flex-row">
                {(['disabled', 'allow', 'block'] as const).map((m) => {
                  const active = policy.mode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={savingMode || active}
                      onClick={() => onModeChange(m)}
                      className={[
                        'flex-1 rounded-md border px-3 py-2 text-sm transition',
                        active
                          ? 'border-cm-accent bg-cm-accent-soft font-medium text-cm-fg'
                          : 'border-cm-border text-cm-muted hover:border-cm-accent-line hover:text-cm-fg',
                        savingMode ? 'opacity-60' : '',
                      ].join(' ')}
                    >
                      {MODE_LABEL[m]}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-cm-muted">{MODE_HINT[policy.mode]}</p>
              {policy.mode === 'allow' && policy.models.length === 0 && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-cm-cite-line bg-cm-cite-bg p-3 text-xs text-cm-cite">
                  <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Allow mode is on with an empty list. Every /v1/ask call will be rejected
                    until you add at least one approved model.
                  </span>
                </div>
              )}
              <p className="mt-3 text-xs text-cm-muted">
                Last updated {fmtDate(policy.updatedAt)}
                {policy.updatedBy ? ` by ${policy.updatedBy}` : ''}.
              </p>
            </section>

            <section className="mb-8 rounded-lg border border-cm-border bg-cm-paper p-5">
              <h2 className="mb-3 text-sm font-medium text-cm-fg">Add a model</h2>
              <form onSubmit={onAdd} className="flex flex-col gap-3">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="model id, e.g. gpt-4o-mini"
                    className={INPUT_CLS}
                    maxLength={200}
                    required
                  />
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="label (optional)"
                    className={INPUT_CLS}
                    maxLength={120}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={saving || !model.trim()}
                    className="inline-flex items-center gap-2 rounded-md bg-cm-fg px-3 py-2 text-sm font-medium text-cm-bg hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? <Spinner /> : <IconPlus className="h-4 w-4" />}
                    Add model
                  </button>
                  <button
                    type="button"
                    onClick={() => void load()}
                    className="inline-flex items-center gap-2 rounded-md border border-cm-border px-3 py-2 text-sm text-cm-fg hover:bg-cm-subtle"
                  >
                    <IconRefresh className="h-4 w-4" /> Refresh
                  </button>
                </div>
              </form>
              {actionError && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] p-3 text-xs text-cm-danger">
                  <IconWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}
              {savedAt && !actionError && (
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] px-2.5 py-1 text-xs text-cm-success">
                  Saved {fmtDate(savedAt)}
                </p>
              )}
            </section>

            <section className="rounded-lg border border-cm-border bg-cm-paper">
              <div className="border-b border-cm-border p-5">
                <h2 className="text-sm font-medium text-cm-fg">
                  Configured models{' '}
                  <span className="text-cm-muted">({policy.models.length})</span>
                </h2>
              </div>
              {policy.models.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="No models configured"
                    body="Add a model id above. Match is case-insensitive against the tag returned by the LLM provider."
                  />
                </div>
              ) : (
                <ul className="divide-y divide-cm-border">
                  {policy.models.map((rule: ModelAllowlistRule) => (
                    <li
                      key={rule.id}
                      className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <code className="block truncate font-mono text-sm text-cm-fg">
                          {rule.model}
                        </code>
                        <p className="mt-0.5 text-xs text-cm-muted">
                          {rule.label ? `${rule.label} - ` : ''}added {fmtDate(rule.createdAt)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void onRemove(rule.id)}
                        disabled={removingId === rule.id}
                        className="inline-flex items-center gap-2 self-start rounded-md border border-cm-border px-3 py-1.5 text-xs text-cm-fg transition hover:border-[var(--cm-danger)] hover:bg-[rgba(180,66,60,0.10)] hover:text-cm-danger disabled:opacity-50 sm:self-auto"
                      >
                        {removingId === rule.id ? (
                          <Spinner />
                        ) : (
                          <IconTrash className="h-3.5 w-3.5" />
                        )}
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
