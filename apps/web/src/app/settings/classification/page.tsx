'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  type ClassificationPolicy,
  type ClassificationPolicyLimits,
  type ClassificationLabel,
  type ClassificationLabelEntry,
} from '@/lib/api';
import {
  ErrorState,
  Spinner,
  IconArrowRight,
  IconCheck,
  IconShield,
  IconWarning,
  IconPlus,
  IconTrash,
  IconTag,
} from '@clawmind/ui';

const LABEL_DESCRIPTIONS: Record<ClassificationLabel, string> = {
  public: 'Cleared for unrestricted external distribution.',
  internal: 'Workspace members only. The default for unlabelled paths.',
  confidential: 'Limited circulation. Cited only inside the workspace.',
  restricted: 'Regulated or contractual. No external sharing under any circumstance.',
};

function fmtDate(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

function labelTone(label: ClassificationLabel): string {
  switch (label) {
    case 'public':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
    case 'internal':
      return 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300';
    case 'confidential':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300';
    case 'restricted':
      return 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300';
  }
}

export default function ClassificationPage() {
  const [policy, setPolicy] = useState<ClassificationPolicy | null>(null);
  const [limits, setLimits] = useState<ClassificationPolicyLimits | null>(null);
  const [items, setItems] = useState<ClassificationLabelEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cap, setCap] = useState<ClassificationLabel>('restricted');
  const [defaultLabel, setDefaultLabel] = useState<ClassificationLabel>('internal');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [newPath, setNewPath] = useState('');
  const [newLabel, setNewLabel] = useState<ClassificationLabel>('confidential');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, list] = await Promise.all([
        api.classificationPolicyGet(),
        api.classificationLabelsList(),
      ]);
      setPolicy(p.policy);
      setLimits(p.limits);
      setCap(p.policy.allowPublicShareUpTo);
      setDefaultLabel(p.policy.defaultLabel);
      setItems(list);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You need admin or owner access to view data classification.');
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

  const savePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setSaving(true);
    try {
      const next = await api.classificationPolicySet({
        allowPublicShareUpTo: cap,
        defaultLabel,
      });
      setPolicy(next);
      setSavedAt(Date.now());
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'save failed';
      setActionError(msg);
    } finally {
      setSaving(false);
    }
  };

  const addLabel = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    const path = newPath.trim();
    if (!path) return;
    setAdding(true);
    try {
      await api.classificationLabelSet(path, newLabel);
      const list = await api.classificationLabelsList();
      setItems(list);
      setNewPath('');
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'label failed';
      setActionError(msg);
    } finally {
      setAdding(false);
    }
  };

  const removeLabel = async (path: string) => {
    setActionError(null);
    try {
      await api.classificationLabelSet(path, null);
      setItems((prev) => (prev ? prev.filter((i) => i.path !== path) : prev));
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'remove failed';
      setActionError(msg);
    }
  };

  const updateLabel = async (path: string, label: ClassificationLabel) => {
    setActionError(null);
    try {
      await api.classificationLabelSet(path, label);
      setItems((prev) =>
        prev ? prev.map((i) => (i.path === path ? { path, label } : i)) : prev,
      );
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'update failed';
      setActionError(msg);
    }
  };

  const allLabels: readonly ClassificationLabel[] = useMemo(
    () => limits?.labels ?? (['public', 'internal', 'confidential', 'restricted'] as const),
    [limits],
  );

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-3 text-sm text-muted-foreground">
          <Link href="/settings" className="hover:text-foreground">
            Settings
          </Link>
          <IconArrowRight size={14} />
          <span className="text-foreground">Data classification</span>
        </div>

        <header className="mb-8">
          <div className="flex items-start gap-3">
            <IconShield size={28} className="mt-1 text-primary" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Data classification</h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Tag every source with a sensitivity label and cap which labels are allowed in
                public share links. Violations are rejected at mint time and recorded in the audit
                log with the offending path.
              </p>
            </div>
          </div>
        </header>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading classification
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : policy ? (
          <div className="space-y-8">
            <form
              onSubmit={savePolicy}
              className="space-y-6 rounded-lg border bg-card p-6 shadow-sm"
            >
              <div className="space-y-2">
                <label htmlFor="cap" className="block text-sm font-medium">
                  Allow public sharing up to
                </label>
                <select
                  id="cap"
                  value={cap}
                  onChange={(e) => setCap(e.target.value as ClassificationLabel)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-64"
                >
                  {allLabels.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {LABEL_DESCRIPTIONS[cap]} Sources labelled above this level cannot be cited in
                  a public share.
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor="def" className="block text-sm font-medium">
                  Default label for unlabelled paths
                </label>
                <select
                  id="def"
                  value={defaultLabel}
                  onChange={(e) => setDefaultLabel(e.target.value as ClassificationLabel)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-64"
                >
                  {allLabels.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {LABEL_DESCRIPTIONS[defaultLabel]} Pick a stricter default to quarantine new
                  content from share-by-default until it is reviewed.
                </p>
              </div>

              {actionError ? (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  <IconWarning size={16} />
                  <span>{actionError}</span>
                </div>
              ) : null}

              <div className="flex items-center justify-between border-t pt-4">
                <p className="text-xs text-muted-foreground">
                  Last updated by{' '}
                  <span className="font-mono">{policy.updatedBy ?? 'never set'}</span> on{' '}
                  {fmtDate(policy.updatedAt)}.
                </p>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? <Spinner /> : <IconCheck size={16} />}
                  Save policy
                </button>
              </div>

              {savedAt ? (
                <p className="text-xs text-muted-foreground">Saved {fmtDate(savedAt)}.</p>
              ) : null}
            </form>

            <section className="rounded-lg border bg-card p-6 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <IconTag size={18} className="text-primary" />
                <h2 className="text-lg font-semibold tracking-tight">Labelled paths</h2>
              </div>

              <form onSubmit={addLabel} className="mb-6 flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  placeholder="docs/handbook.md"
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                  aria-label="Path to label"
                />
                <select
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value as ClassificationLabel)}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-40"
                  aria-label="Label to apply"
                >
                  {allLabels.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={adding || !newPath.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {adding ? <Spinner /> : <IconPlus size={16} />}
                  Apply
                </button>
              </form>

              {items && items.length > 0 ? (
                <ul className="divide-y divide-border rounded-md border">
                  {items.map((it) => (
                    <li
                      key={it.path}
                      className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <code className="break-all text-sm">{it.path}</code>
                      <div className="flex items-center gap-2">
                        <select
                          value={it.label}
                          onChange={(e) =>
                            void updateLabel(it.path, e.target.value as ClassificationLabel)
                          }
                          className={`rounded-md border px-2 py-1 text-xs ${labelTone(it.label)}`}
                          aria-label={`Label for ${it.path}`}
                        >
                          {allLabels.map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => void removeLabel(it.path)}
                          className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                          aria-label={`Remove label from ${it.path}`}
                        >
                          <IconTrash size={14} />
                          Clear
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  No paths labelled yet. Apply a label above to start scoping what can leave the
                  workspace.
                </p>
              )}
            </section>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No policy returned.</p>
        )}
      </main>
    </div>
  );
}
