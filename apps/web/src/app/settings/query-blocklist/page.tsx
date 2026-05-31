'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, type BlocklistRule, ApiError } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconArrowRight,
  IconPlus,
  IconRefresh,
  IconShield,
  IconTrash,
  IconWarning,
} from '@clawmind/ui';

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

export default function QueryBlocklistPage() {
  const [rules, setRules] = useState<BlocklistRule[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pattern, setPattern] = useState('');
  const [mode, setMode] = useState<'literal' | 'regex'>('literal');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.queryBlocklistList();
      setRules(list);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You do not have permission to view the workspace query blocklist.');
      } else if (err instanceof ApiError && err.status === 401) {
        setError('Sign in to view the workspace query blocklist.');
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

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!pattern.trim()) return;
    setSaving(true);
    setActionError(null);
    try {
      await api.queryBlocklistAdd({
        pattern: pattern.trim(),
        mode,
        label: label.trim() || null,
      });
      setPattern('');
      setLabel('');
      setSavedAt(Date.now());
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setActionError(
            'A recent MFA step-up is required to change the blocklist. Verify on the MFA page and retry.',
          );
        } else if (err.status === 403) {
          setActionError('Only the workspace owner can edit the blocklist.');
        } else if (err.status === 400) {
          setActionError(err.message || 'invalid pattern');
        } else {
          setActionError(err.message);
        }
      } else {
        setActionError(err instanceof Error ? err.message : 'failed to save');
      }
    } finally {
      setSaving(false);
    }
  }

  async function onRemove(id: string) {
    setRemovingId(id);
    setActionError(null);
    try {
      await api.queryBlocklistRemove(id);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setActionError(
          'A recent MFA step-up is required to remove a rule. Verify on the MFA page and retry.',
        );
      } else {
        setActionError(err instanceof Error ? err.message : 'failed to remove');
      }
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-bg text-fg">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-6">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
          >
            <IconArrowRight size={14} className="rotate-180" />
            Settings
          </Link>
        </div>

        <header className="mb-8 flex items-start gap-3">
          <div className="rounded-lg border border-border bg-surface p-2">
            <IconShield size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Query blocklist</h1>
            <p className="mt-1 text-sm text-fg-muted">
              Patterns matched here block ask, search, and explain before retrieval or
              the model. Use for prompt-injection triage, banned topics, and PII egress.
            </p>
          </div>
        </header>

        {loading ? (
          <div className="space-y-3" aria-busy="true">
            <div className="h-24 animate-pulse rounded-md border border-border bg-surface" />
            <div className="h-12 animate-pulse rounded-md border border-border bg-surface" />
            <div className="h-12 animate-pulse rounded-md border border-border bg-surface" />
            <div className="sr-only">
              <Spinner />
              Loading
            </div>
          </div>
        ) : error ? (
          <ErrorState
            title="Could not load blocklist"
            message={error}
            onRetry={load}
          />
        ) : (
          <>
            <section className="mb-8 rounded-md border border-border bg-surface p-4">
              <h2 className="text-sm font-medium">Add a rule</h2>
              <p className="mt-1 text-xs text-fg-muted">
                Owner only. Requires a recent MFA step-up. Literal matches are
                case-insensitive substrings. Regex is compiled with the case-insensitive
                flag.
              </p>
              <form onSubmit={onAdd} className="mt-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium" htmlFor="pattern">
                    Pattern
                  </label>
                  <input
                    id="pattern"
                    value={pattern}
                    onChange={(e) => setPattern(e.target.value)}
                    placeholder="project alpha"
                    required
                    maxLength={500}
                    className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-fg"
                  />
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="flex-1">
                    <label className="block text-xs font-medium" htmlFor="mode">
                      Match mode
                    </label>
                    <select
                      id="mode"
                      value={mode}
                      onChange={(e) => setMode(e.target.value as 'literal' | 'regex')}
                      className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-fg"
                    >
                      <option value="literal">literal (substring)</option>
                      <option value="regex">regex</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium" htmlFor="label">
                      Label (optional)
                    </label>
                    <input
                      id="label"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="restricted matter"
                      maxLength={120}
                      className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-fg"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={saving || !pattern.trim()}
                    className="inline-flex items-center gap-2 rounded-md border border-fg bg-fg px-3 py-1.5 text-xs font-medium text-bg disabled:opacity-50"
                  >
                    {saving ? <Spinner /> : <IconPlus size={14} />}
                    Add rule
                  </button>
                  <button
                    type="button"
                    onClick={load}
                    className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
                  >
                    <IconRefresh size={14} />
                    Refresh
                  </button>
                  {savedAt ? (
                    <span className="text-xs text-fg-muted">
                      Saved {fmtDate(savedAt)}
                    </span>
                  ) : null}
                </div>
                {actionError ? (
                  <div className="flex items-start gap-2 rounded-md border border-border bg-bg p-2 text-xs text-fg">
                    <IconWarning size={14} className="mt-0.5 shrink-0" />
                    <span>{actionError}</span>
                  </div>
                ) : null}
              </form>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-medium">Active rules</h2>
                <span className="text-xs text-fg-muted">{rules?.length ?? 0} total</span>
              </div>
              {!rules || rules.length === 0 ? (
                <EmptyState
                  title="No rules yet"
                  body="Add your first pattern above to start blocking matching queries across the workspace."
                />
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border bg-surface">
                  {rules.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg-muted">
                            {r.mode}
                          </span>
                          <code className="truncate font-mono text-sm">{r.pattern}</code>
                        </div>
                        <div className="mt-1 text-xs text-fg-muted">
                          {r.label ? <span>{r.label} </span> : null}
                          Added {fmtDate(r.createdAt)} by {r.createdBy}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemove(r.id)}
                        disabled={removingId === r.id}
                        className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border px-2 py-1 text-xs text-fg-muted hover:text-fg disabled:opacity-50"
                        aria-label={`Remove rule ${r.pattern}`}
                      >
                        {removingId === r.id ? <Spinner /> : <IconTrash size={14} />}
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
