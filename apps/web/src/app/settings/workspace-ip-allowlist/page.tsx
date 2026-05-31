'use client';
// Workspace IP allowlist settings page. Owner-only enforcement is on the
// server; this page renders a 403 message if a non-owner navigates here.
// The dirty/save model mirrors the per-user IP allowlist page so an
// operator who has used one already knows this one.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  type WorkspaceIpAllowlistRecord,
  type IpAllowlistLimits,
} from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconShield,
  IconNetwork,
  IconPlus,
  IconTrash,
  IconCheck,
  IconWarning,
  IconArrowRight,
} from '@clawmind/ui';

interface DraftRule {
  id: string;
  cidr: string;
  label: string;
  saved: boolean;
}

function nextId(): string {
  return `r_${Math.random().toString(36).slice(2, 10)}`;
}

function toDraft(record: WorkspaceIpAllowlistRecord): DraftRule[] {
  return record.rules.map((r) => ({
    id: nextId(),
    cidr: r.cidr,
    label: r.label,
    saved: true,
  }));
}

function isDirty(record: WorkspaceIpAllowlistRecord, enabled: boolean, draft: DraftRule[]): boolean {
  if (record.enabled !== enabled) return true;
  if (record.rules.length !== draft.length) return true;
  for (let i = 0; i < draft.length; i++) {
    const a = draft[i]!;
    const b = record.rules[i];
    if (!b) return true;
    if (a.cidr.trim() !== b.cidr) return true;
    if (a.label.trim() !== b.label) return true;
  }
  return false;
}

export default function WorkspaceIpAllowlistPage() {
  const [record, setRecord] = useState<WorkspaceIpAllowlistRecord | null>(null);
  const [limits, setLimits] = useState<IpAllowlistLimits | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [draft, setDraft] = useState<DraftRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [confirmLockout, setConfirmLockout] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await api.workspaceIpAllowlistGet();
      setRecord(res.record);
      setLimits(res.limits);
      setEnabled(res.record.enabled);
      setDraft(toDraft(res.record));
      setConfirmLockout(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to load workspace IP allowlist.');
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
    setDraft((d) => [...d, { id: nextId(), cidr: '', label: '', saved: false }]);
  }, [draft.length, limits]);

  const removeRule = useCallback((id: string) => {
    setDraft((d) => d.filter((r) => r.id !== id));
  }, []);

  const updateRule = useCallback((id: string, patch: Partial<DraftRule>) => {
    setDraft((d) =>
      d.map((r) => (r.id === id ? { ...r, ...patch, saved: false } : r)),
    );
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveErr(null);
    try {
      const payload = {
        enabled,
        rules: draft
          .map((r) => ({ cidr: r.cidr.trim(), label: r.label.trim() || undefined }))
          .filter((r) => r.cidr.length > 0),
        confirmSelfLockoutAccepted: confirmLockout || undefined,
      };
      const next = await api.workspaceIpAllowlistPut(payload);
      setRecord(next);
      setDraft(toDraft(next));
      setEnabled(next.enabled);
      setSavedAt(Date.now());
      setConfirmLockout(false);
    } catch (e) {
      if (e instanceof ApiError) {
        setSaveErr(e.message);
      } else {
        setSaveErr('Failed to save workspace IP allowlist.');
      }
    } finally {
      setSaving(false);
    }
  }, [enabled, draft, confirmLockout]);

  const dirty = record ? isDirty(record, enabled, draft) : false;
  const ruleCount = draft.filter((r) => r.cidr.trim().length > 0).length;

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-start gap-3">
          <IconShield className="mt-1 h-6 w-6 text-foreground" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Workspace IP allowlist</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Lock the entire workspace down to a fixed set of corporate IP ranges. Applies to every
              authenticated request from every member, including API keys. Liveness and the controls
              on this page are never gated.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Owner only. See also the{' '}
              <Link href="/settings/security" className="underline">
                per-user allowlist
              </Link>{' '}
              if a single account needs its own range.
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
                  <div className="font-medium">Enforce workspace allowlist</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    When on, only requests from a listed range will reach the API for any member of
                    this workspace. Off keeps the workspace open and the rules are kept on file.
                  </div>
                </div>
              </label>
            </section>

            <section className="rounded-md border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <div className="flex items-center gap-2">
                  <IconNetwork className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-medium">Allowed ranges</h2>
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
                  <IconPlus className="h-3.5 w-3.5" /> Add range
                </button>
              </div>
              {draft.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                  No ranges yet. Add an IP or CIDR like 203.0.113.0/24.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {draft.map((r) => (
                    <li key={r.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
                      <input
                        value={r.cidr}
                        onChange={(e) => updateRule(r.id, { cidr: e.target.value })}
                        placeholder="203.0.113.0/24"
                        className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-sm sm:w-64"
                      />
                      <input
                        value={r.label}
                        onChange={(e) => updateRule(r.id, { label: e.target.value })}
                        placeholder="Label (e.g. HQ VPN)"
                        maxLength={limits.maxLabel}
                        className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm sm:flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => removeRule(r.id)}
                        className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label="Remove range"
                      >
                        <IconTrash className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {enabled && (
              <label className="flex items-start gap-3 rounded-md border border-border bg-card p-4 text-sm">
                <input
                  type="checkbox"
                  checked={confirmLockout}
                  onChange={(e) => setConfirmLockout(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-foreground"
                />
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    <IconWarning className="h-4 w-4 text-amber-600" />
                    I understand my current IP may not be allowed
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Only required for break-glass changes from a bastion outside the corporate range.
                    Without this, the server will refuse a change that would lock you out.
                  </div>
                </div>
              </label>
            )}

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
                Save workspace allowlist
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
