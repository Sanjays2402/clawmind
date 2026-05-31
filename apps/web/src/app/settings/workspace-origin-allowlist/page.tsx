'use client';
// Workspace browser Origin (CORS) allowlist settings page. Owner-only
// enforcement is on the server; this page renders a 403 message if a
// non-owner navigates here. The dirty/save model mirrors the workspace IP
// allowlist page so an operator who has used one already knows this one.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  type WorkspaceOriginAllowlistRecord,
  type WorkspaceOriginAllowlistLimits,
} from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconShield,
  IconLink,
  IconPlus,
  IconTrash,
  IconCheck,
  IconArrowRight,
} from '@clawmind/ui';

interface DraftRule {
  id: string;
  origin: string;
  label: string;
  saved: boolean;
}

function nextId(): string {
  return `r_${Math.random().toString(36).slice(2, 10)}`;
}

function toDraft(record: WorkspaceOriginAllowlistRecord): DraftRule[] {
  return record.rules.map((r) => ({
    id: nextId(),
    origin: r.origin,
    label: r.label,
    saved: true,
  }));
}

function isDirty(record: WorkspaceOriginAllowlistRecord, enabled: boolean, draft: DraftRule[]): boolean {
  if (record.enabled !== enabled) return true;
  if (record.rules.length !== draft.length) return true;
  for (let i = 0; i < draft.length; i++) {
    const a = draft[i]!;
    const b = record.rules[i];
    if (!b) return true;
    if (a.origin.trim() !== b.origin) return true;
    if (a.label.trim() !== b.label) return true;
  }
  return false;
}

export default function WorkspaceOriginAllowlistPage() {
  const [record, setRecord] = useState<WorkspaceOriginAllowlistRecord | null>(null);
  const [limits, setLimits] = useState<WorkspaceOriginAllowlistLimits | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [draft, setDraft] = useState<DraftRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await api.workspaceOriginAllowlistGet();
      setRecord(res.record);
      setLimits(res.limits);
      setEnabled(res.record.enabled);
      setDraft(toDraft(res.record));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to load workspace origin allowlist.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addRule = useCallback(() => {
    if (!limits) return;
    if (draft.length >= limits.maxRules) return;
    setDraft((d) => [...d, { id: nextId(), origin: '', label: '', saved: false }]);
  }, [draft.length, limits]);

  const removeRule = useCallback((id: string) => {
    setDraft((d) => d.filter((r) => r.id !== id));
  }, []);

  const updateRule = useCallback((id: string, patch: Partial<DraftRule>) => {
    setDraft((d) => d.map((r) => (r.id === id ? { ...r, ...patch, saved: false } : r)));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveErr(null);
    try {
      const payload = {
        enabled,
        rules: draft
          .map((r) => ({ origin: r.origin.trim(), label: r.label.trim() || undefined }))
          .filter((r) => r.origin.length > 0),
      };
      const next = await api.workspaceOriginAllowlistPut(payload);
      setRecord(next);
      setDraft(toDraft(next));
      setEnabled(next.enabled);
      setSavedAt(Date.now());
    } catch (e) {
      setSaveErr(e instanceof ApiError ? e.message : 'Failed to save workspace origin allowlist.');
    } finally {
      setSaving(false);
    }
  }, [enabled, draft]);

  const dirty = record ? isDirty(record, enabled, draft) : false;
  const ruleCount = draft.filter((r) => r.origin.trim().length > 0).length;

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-start gap-3">
          <IconShield className="mt-1 h-6 w-6 text-foreground" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Workspace origin allowlist</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Add the browser origins your dashboards run from so the API will accept their CORS
              preflight. The vendor dashboard origin is always permitted via the static config; this
              list is additive.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Owner only. Server-to-server clients are unaffected since CORS only applies to
              browsers. See also the{' '}
              <Link href="/keys" className="underline">
                per-key origin restriction
              </Link>{' '}
              to lock a single key to one page.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
            <Spinner /> Loading
          </div>
        ) : err ? (
          <ErrorState title="Could not load allowlist" message={err} onRetry={load} />
        ) : !record || !limits ? (
          <EmptyState title="No data" body="Nothing to show yet." />
        ) : (
          <div className="space-y-6">
            <section className="rounded-md border border-border bg-card p-5">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-foreground"
                />
                <div>
                  <div className="font-medium">Enforce workspace origin allowlist</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    When on, browsers loading these origins may call the API in addition to the
                    vendor baseline. Off keeps the workspace at the baseline only and the rules are
                    kept on file.
                  </div>
                </div>
              </label>
            </section>

            <section className="rounded-md border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <div className="flex items-center gap-2">
                  <IconLink className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-medium">Allowed origins</h2>
                  <span className="text-xs text-muted-foreground">
                    {ruleCount} of {limits.maxRules}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={addRule}
                  disabled={draft.length >= limits.maxRules}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IconPlus className="h-3.5 w-3.5" /> Add origin
                </button>
              </div>
              {draft.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                  No origins yet. Add a full scheme + host like https://app.acme.com.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {draft.map((r) => (
                    <li key={r.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
                      <input
                        value={r.origin}
                        onChange={(e) => updateRule(r.id, { origin: e.target.value })}
                        placeholder="https://app.acme.com"
                        className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-sm sm:w-72"
                      />
                      <input
                        value={r.label}
                        onChange={(e) => updateRule(r.id, { label: e.target.value })}
                        placeholder="Label (e.g. internal portal)"
                        maxLength={limits.maxLabel}
                        className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm sm:flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => removeRule(r.id)}
                        className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label="Remove origin"
                      >
                        <IconTrash className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {saveErr && (
              <div className="rounded-md border border-destructive bg-destructive/10 px-4 py-2 text-sm text-destructive">
                {saveErr}
              </div>
            )}
            {savedAt && !saveErr && !dirty && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <IconCheck className="h-4 w-4 text-emerald-600" /> Saved
              </div>
            )}

            <div className="flex items-center justify-between">
              <Link
                href="/admin"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                Back to admin <IconArrowRight className="h-3.5 w-3.5" />
              </Link>
              <button
                type="button"
                onClick={save}
                disabled={!dirty || saving}
                className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Spinner /> : null}
                Save workspace origins
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
