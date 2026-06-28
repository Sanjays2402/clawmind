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

// Shared input styling: theme-aware surface + brand focus ring.
const INPUT_CLS =
  'rounded-md border border-cm-border bg-cm-bg px-2.5 py-1.5 text-sm text-cm-fg outline-none placeholder:text-cm-faint focus:ring-2 focus:ring-cm-accent';

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

  // Enforcement posture: success when locked down to N ranges, cite-gold
  // caution when enforcement is on but no range is filled (a save that
  // would reject every request), muted when off entirely.
  const posture: 'locked' | 'gap' | 'off' = !enabled
    ? 'off'
    : ruleCount > 0
      ? 'locked'
      : 'gap';

  return (
    <div className="min-h-screen bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-start gap-3">
          <IconShield className="mt-1 h-6 w-6 text-cm-fg" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Workspace IP allowlist</h1>
            <p className="mt-1 text-sm text-cm-muted">
              Lock the entire workspace down to a fixed set of corporate IP ranges. Applies to every
              authenticated request from every member, including API keys. Liveness and the controls
              on this page are never gated.
            </p>
            <p className="mt-2 text-xs text-cm-muted">
              Owner only. See also the{' '}
              <Link href="/settings/security" className="text-cm-accent hover:underline">
                per-user allowlist
              </Link>{' '}
              if a single account needs its own range.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-12 text-sm text-cm-muted">
            <Spinner /> Loading
          </div>
        ) : err ? (
          <ErrorState title="Could not load allowlist" message={err} onRetry={load} />
        ) : !record || !limits ? (
          <EmptyState title="No data" body="Nothing to show yet." />
        ) : (
          <div className="space-y-6">
            {/* Live enforcement posture for the whole workspace. */}
            {posture === 'locked' && (
              <div className="flex items-start gap-2 rounded-md border border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] p-3 text-xs text-cm-success">
                <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Locked down. Every authenticated request must originate from one
                  of {ruleCount} allowed {ruleCount === 1 ? 'range' : 'ranges'};
                  all other source IPs are rejected workspace-wide.
                </span>
              </div>
            )}
            {posture === 'gap' && (
              <div className="flex items-start gap-2 rounded-md border border-cm-cite-line bg-cm-cite-bg p-3 text-xs text-cm-cite">
                <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Enforcement is on with no range filled. Saving now would reject
                  every request to the workspace - add at least one range below.
                </span>
              </div>
            )}
            {posture === 'off' && (
              <div className="flex items-start gap-2 rounded-md border border-cm-border bg-cm-subtle p-3 text-xs text-cm-muted">
                <IconNetwork className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Open. Requests are accepted from any source IP. Rules below are
                  kept on file until you turn enforcement on.
                </span>
              </div>
            )}

            <section className="rounded-md border border-cm-border bg-cm-paper p-5">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-cm-accent"
                />
                <div>
                  <div className="font-medium">Enforce workspace allowlist</div>
                  <div className="mt-1 text-sm text-cm-muted">
                    When on, only requests from a listed range will reach the API for any member of
                    this workspace. Off keeps the workspace open and the rules are kept on file.
                  </div>
                </div>
              </label>
            </section>

            <section className="rounded-md border border-cm-border bg-cm-paper">
              <div className="flex items-center justify-between border-b border-cm-border px-5 py-3">
                <div className="flex items-center gap-2">
                  <IconNetwork className="h-4 w-4 text-cm-muted" />
                  <h2 className="text-sm font-medium">Allowed ranges</h2>
                  <span className="text-xs text-cm-muted">
                    {ruleCount} of {limits.maxRules}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={addRule}
                  disabled={draft.length >= limits.maxRules}
                  className="inline-flex items-center gap-1 rounded-md border border-cm-border px-2.5 py-1 text-xs hover:bg-cm-subtle disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IconPlus className="h-3.5 w-3.5" /> Add range
                </button>
              </div>
              {draft.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-cm-muted">
                  No ranges yet. Add an IP or CIDR like 203.0.113.0/24.
                </div>
              ) : (
                <ul className="divide-y divide-cm-border">
                  {draft.map((r) => {
                    const active = r.cidr.trim().length > 0;
                    return (
                      <li
                        key={r.id}
                        className={[
                          'flex flex-col gap-2 p-4 transition-colors sm:flex-row sm:items-center',
                          active ? 'bg-cm-paper' : 'bg-cm-subtle/40',
                        ].join(' ')}
                      >
                        <input
                          value={r.cidr}
                          onChange={(e) => updateRule(r.id, { cidr: e.target.value })}
                          placeholder="203.0.113.0/24"
                          className={`${INPUT_CLS} w-full font-mono sm:w-64`}
                        />
                        <input
                          value={r.label}
                          onChange={(e) => updateRule(r.id, { label: e.target.value })}
                          placeholder="Label (e.g. HQ VPN)"
                          maxLength={limits.maxLabel}
                          className={`${INPUT_CLS} w-full sm:flex-1`}
                        />
                        <button
                          type="button"
                          onClick={() => removeRule(r.id)}
                          className="inline-flex items-center justify-center rounded-md border border-cm-border p-1.5 text-cm-muted transition hover:border-[var(--cm-danger)] hover:bg-[rgba(180,66,60,0.10)] hover:text-cm-danger"
                          aria-label="Remove range"
                        >
                          <IconTrash className="h-4 w-4" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {enabled && (
              <label className="flex items-start gap-3 rounded-md border border-cm-cite-line bg-cm-cite-bg p-4 text-sm">
                <input
                  type="checkbox"
                  checked={confirmLockout}
                  onChange={(e) => setConfirmLockout(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-cm-accent"
                />
                <div>
                  <div className="flex items-center gap-2 font-medium text-cm-cite">
                    <IconWarning className="h-4 w-4" />
                    I understand my current IP may not be allowed
                  </div>
                  <div className="mt-1 text-xs text-cm-muted">
                    Only required for break-glass changes from a bastion outside the corporate range.
                    Without this, the server will refuse a change that would lock you out.
                  </div>
                </div>
              </label>
            )}

            {saveErr && (
              <div className="rounded-md border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] px-4 py-2 text-sm text-cm-danger">
                {saveErr}
              </div>
            )}
            {savedAt && !saveErr && !dirty && (
              <div className="flex items-center gap-2 text-sm text-cm-success">
                <IconCheck className="h-4 w-4" /> Saved
              </div>
            )}

            <div className="flex items-center justify-between">
              <Link
                href="/admin"
                className="inline-flex items-center gap-1 text-sm text-cm-muted hover:text-cm-fg"
              >
                Back to admin <IconArrowRight className="h-3.5 w-3.5" />
              </Link>
              <button
                type="button"
                onClick={save}
                disabled={!dirty || saving}
                className="inline-flex items-center gap-2 rounded-md bg-cm-fg px-4 py-2 text-sm font-medium text-cm-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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
