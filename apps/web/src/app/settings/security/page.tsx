'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, ApiError, type IpAllowlistRecord, type IpAllowlistLimits } from '@/lib/api';
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
  IconSettings,
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

function toDraft(record: IpAllowlistRecord): DraftRule[] {
  return record.rules.map((r) => ({
    id: nextId(),
    cidr: r.cidr,
    label: r.label,
    saved: true,
  }));
}

function isDirty(record: IpAllowlistRecord, enabled: boolean, draft: DraftRule[]): boolean {
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

export default function SecurityPage() {
  const [record, setRecord] = useState<IpAllowlistRecord | null>(null);
  const [limits, setLimits] = useState<IpAllowlistLimits | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [draft, setDraft] = useState<DraftRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ field: string | null; message: string } | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.ipAllowlistGet();
      setRecord(res.record);
      setLimits(res.limits);
      setEnabled(res.record.enabled);
      setDraft(toDraft(res.record));
      setSaveError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addRule = () => {
    if (limits && draft.length >= limits.maxRules) return;
    setDraft((d) => [...d, { id: nextId(), cidr: '', label: '', saved: false }]);
    setSavedAt(null);
  };

  const removeRule = (id: string) => {
    setDraft((d) => d.filter((r) => r.id !== id));
    setSavedAt(null);
  };

  const updateRule = (id: string, patch: Partial<DraftRule>) => {
    setDraft((d) => d.map((r) => (r.id === id ? { ...r, ...patch, saved: false } : r)));
    setSavedAt(null);
  };

  const save = async () => {
    if (!record) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        enabled,
        rules: draft.map((r) => ({ cidr: r.cidr.trim(), label: r.label.trim() })),
      };
      const next = await api.ipAllowlistPut(payload);
      setRecord(next);
      setEnabled(next.enabled);
      setDraft(toDraft(next));
      setSavedAt(Date.now());
    } catch (err) {
      if (err instanceof ApiError && err.body && typeof err.body === 'object') {
        const body = err.body as { field?: string | null; message?: string };
        setSaveError({ field: body.field ?? null, message: body.message ?? err.message });
      } else {
        setSaveError({ field: null, message: (err as Error).message });
      }
    } finally {
      setSaving(false);
    }
  };

  const dirty = record ? isDirty(record, enabled, draft) : false;
  const ruleCount = draft.length;
  const overLimit = limits ? ruleCount > limits.maxRules : false;
  const canEnable = ruleCount > 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="rounded-md border bg-muted/30 p-2 text-primary">
              <IconShield size={22} />
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">IP allowlist</h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Restrict your account to a set of trusted networks. When enabled,
                requests from any other address get a 403 response. The settings
                page itself is always reachable so you can never lock yourself out.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Link
              href="/settings"
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 hover:bg-muted/50"
            >
              <IconSettings size={14} />
              Settings
            </Link>
            <Link
              href="/audit"
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 hover:bg-muted/50"
            >
              Audit log
              <IconArrowRight size={14} />
            </Link>
          </div>
        </header>

        {loading && (
          <div className="rounded-lg border bg-card p-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner size={14} />
              Loading allowlist
            </div>
          </div>
        )}

        {!loading && error && (
          <ErrorState title="Could not load allowlist" message={error} onRetry={load} />
        )}

        {!loading && !error && record && limits && (
          <div className="space-y-6">
            <section className="rounded-lg border bg-card p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0 rounded-md border bg-muted/30 p-2 text-muted-foreground">
                  <IconNetwork size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <label htmlFor="enabled" className="block text-sm font-medium">
                    Enforce allowlist
                  </label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {enabled
                      ? 'On. Requests from any address not in the list below will be rejected.'
                      : 'Off. The list is saved but not enforced. Turn this on when your rules cover every network you use.'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    id="enabled"
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={enabled ? 'Disable allowlist enforcement' : 'Enable allowlist enforcement'}
                    disabled={!enabled && !canEnable}
                    onClick={() => {
                      setEnabled((v) => !v);
                      setSavedAt(null);
                    }}
                    className={[
                      'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                      'disabled:cursor-not-allowed disabled:opacity-60',
                      enabled ? 'bg-primary border-primary' : 'bg-muted/40 border-input',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'inline-block size-5 transform rounded-full bg-background shadow transition-transform',
                        enabled ? 'translate-x-5' : 'translate-x-0.5',
                      ].join(' ')}
                    />
                  </button>
                </div>
              </div>
              {enabled && !canEnable && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                  <IconWarning size={14} />
                  <span>Add at least one rule before enforcing the allowlist.</span>
                </div>
              )}
            </section>

            <section className="rounded-lg border bg-card">
              <div className="flex items-center justify-between border-b p-4">
                <div>
                  <h2 className="text-sm font-medium">Trusted networks</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {ruleCount} of {limits.maxRules} rules. Accepts a single IP
                    (203.0.113.7) or a CIDR block (10.0.0.0/24, 2001:db8::/32).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addRule}
                  disabled={ruleCount >= limits.maxRules}
                  className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <IconPlus size={14} />
                  Add rule
                </button>
              </div>

              {draft.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No rules yet"
                    body="Add your office egress IP, your VPN range, and any addresses your automation uses."
                  />
                </div>
              ) : (
                <ul className="divide-y">
                  {draft.map((r, i) => {
                    const fieldErr =
                      saveError &&
                      saveError.field &&
                      saveError.field.startsWith(`rules[${i}]`)
                        ? saveError.message
                        : null;
                    return (
                      <li key={r.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start">
                        <div className="flex-1">
                          <label htmlFor={`cidr-${r.id}`} className="sr-only">
                            IP or CIDR
                          </label>
                          <input
                            id={`cidr-${r.id}`}
                            type="text"
                            inputMode="text"
                            spellCheck={false}
                            autoComplete="off"
                            placeholder="10.0.0.0/24"
                            value={r.cidr}
                            onChange={(e) => updateRule(r.id, { cidr: e.target.value })}
                            aria-invalid={fieldErr ? true : undefined}
                            className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                          {fieldErr && (
                            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErr}</p>
                          )}
                        </div>
                        <div className="flex-1">
                          <label htmlFor={`label-${r.id}`} className="sr-only">
                            Label
                          </label>
                          <input
                            id={`label-${r.id}`}
                            type="text"
                            maxLength={limits.maxLabel}
                            placeholder="office vpn"
                            value={r.label}
                            onChange={(e) => updateRule(r.id, { label: e.target.value })}
                            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeRule(r.id)}
                          aria-label={`Remove rule ${r.cidr || i + 1}`}
                          className="inline-flex shrink-0 items-center justify-center rounded-md border p-2 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                        >
                          <IconTrash size={16} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {saveError && !saveError.field && (
              <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs">
                <IconWarning size={14} />
                <span>{saveError.message}</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">
                {savedAt !== null && !dirty ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <IconCheck size={14} />
                    Saved
                  </span>
                ) : dirty ? (
                  <span>Unsaved changes</span>
                ) : (
                  <span>All changes saved</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={load}
                  disabled={saving || !dirty}
                  className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !dirty || overLimit || (enabled && !canEnable)}
                  className="inline-flex items-center gap-2 rounded-md border bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving && <Spinner size={12} />}
                  Save allowlist
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
