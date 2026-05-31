'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  type WebhookAllowlistRecord,
  type WebhookAllowlistLimits,
} from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconShield,
  IconWebhook,
  IconPlus,
  IconTrash,
  IconCheck,
  IconWarning,
  IconArrowRight,
  IconSettings,
} from '@clawmind/ui';

// Workspace-managed outbound webhook destination allowlist. Owners
// declare the set of hostnames a webhook URL is allowed to point at;
// the API enforces the list at create, update, and on every delivery
// attempt. The page itself mirrors the IP allowlist editor so admins
// see a consistent shape across egress controls.

interface DraftHost {
  id: string;
  host: string;
  label: string;
  saved: boolean;
}

function nextId(): string {
  return `h_${Math.random().toString(36).slice(2, 10)}`;
}

function toDraft(record: WebhookAllowlistRecord): DraftHost[] {
  return record.hosts.map((h) => ({
    id: nextId(),
    host: h.host,
    label: h.label,
    saved: true,
  }));
}

function isDirty(
  record: WebhookAllowlistRecord,
  enabled: boolean,
  draft: DraftHost[],
): boolean {
  if (record.enabled !== enabled) return true;
  if (record.hosts.length !== draft.length) return true;
  for (let i = 0; i < draft.length; i++) {
    const a = draft[i]!;
    const b = record.hosts[i];
    if (!b) return true;
    if (a.host.trim() !== b.host) return true;
    if (a.label.trim() !== b.label) return true;
  }
  return false;
}

export default function WebhookAllowlistPage() {
  const [record, setRecord] = useState<WebhookAllowlistRecord | null>(null);
  const [limits, setLimits] = useState<WebhookAllowlistLimits | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [draft, setDraft] = useState<DraftHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ field: string | null; message: string } | null>(
    null,
  );
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.webhookAllowlistGet();
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

  const addHost = () => {
    if (limits && draft.length >= limits.maxHosts) return;
    setDraft((d) => [...d, { id: nextId(), host: '', label: '', saved: false }]);
    setSavedAt(null);
  };

  const removeHost = (id: string) => {
    setDraft((d) => d.filter((h) => h.id !== id));
    setSavedAt(null);
  };

  const updateHost = (id: string, patch: Partial<DraftHost>) => {
    setDraft((d) => d.map((h) => (h.id === id ? { ...h, ...patch, saved: false } : h)));
    setSavedAt(null);
  };

  const save = async () => {
    if (!record) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        enabled,
        hosts: draft.map((h) => ({ host: h.host.trim(), label: h.label.trim() })),
      };
      const next = await api.webhookAllowlistPut(payload);
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
  const hostCount = draft.length;
  const overLimit = limits ? hostCount > limits.maxHosts : false;
  const canEnable = hostCount > 0;

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
              <h1 className="text-2xl font-semibold tracking-tight">
                Webhook destination allowlist
              </h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Restrict outbound webhook deliveries to an approved set of
                hostnames. When enabled, every webhook URL is checked at
                registration, when edited, and again on each delivery attempt.
                Use an exact host like hooks.acme.com or a wildcard suffix like
                *.events.acme.com.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Link
              href="/webhooks"
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 hover:bg-muted/50"
            >
              <IconWebhook size={14} />
              Webhooks
            </Link>
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
                  <IconWebhook size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <label htmlFor="enabled" className="block text-sm font-medium">
                    Enforce allowlist
                  </label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {enabled
                      ? 'On. Webhooks that point at any host not in the list below are blocked, and in-flight deliveries to revoked hosts stop immediately.'
                      : 'Off. The list is saved but not enforced. Turn this on once it covers every receiver you actually use.'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    id="enabled"
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={
                      enabled
                        ? 'Disable webhook allowlist enforcement'
                        : 'Enable webhook allowlist enforcement'
                    }
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
                  <span>Add at least one host before enforcing the allowlist.</span>
                </div>
              )}
            </section>

            <section className="rounded-lg border bg-card">
              <div className="flex items-center justify-between border-b p-4">
                <div>
                  <h2 className="text-sm font-medium">Approved hosts</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {hostCount} of {limits.maxHosts} hosts. Use an exact name
                    (hooks.acme.com) or a wildcard suffix (*.events.acme.com).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addHost}
                  disabled={hostCount >= limits.maxHosts}
                  className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <IconPlus size={14} />
                  Add host
                </button>
              </div>

              {draft.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No hosts yet"
                    body="Add your receiver hostnames before turning the allowlist on. A typical setup is one exact host per integration plus an optional wildcard for an event bus."
                  />
                </div>
              ) : (
                <ul className="divide-y">
                  {draft.map((h, i) => {
                    const fieldErr =
                      saveError &&
                      saveError.field &&
                      saveError.field.startsWith(`hosts[${i}]`)
                        ? saveError.message
                        : null;
                    return (
                      <li
                        key={h.id}
                        className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start"
                      >
                        <div className="flex-1">
                          <label htmlFor={`host-${h.id}`} className="sr-only">
                            Hostname
                          </label>
                          <input
                            id={`host-${h.id}`}
                            type="text"
                            inputMode="text"
                            spellCheck={false}
                            autoComplete="off"
                            maxLength={limits.maxHostLen}
                            placeholder="hooks.acme.com"
                            value={h.host}
                            onChange={(e) => updateHost(h.id, { host: e.target.value })}
                            aria-invalid={fieldErr ? true : undefined}
                            className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                          {fieldErr && (
                            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                              {fieldErr}
                            </p>
                          )}
                        </div>
                        <div className="flex-1">
                          <label htmlFor={`label-${h.id}`} className="sr-only">
                            Label
                          </label>
                          <input
                            id={`label-${h.id}`}
                            type="text"
                            maxLength={limits.maxLabel}
                            placeholder="prod webhook receiver"
                            value={h.label}
                            onChange={(e) => updateHost(h.id, { label: e.target.value })}
                            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeHost(h.id)}
                          aria-label={`Remove host ${h.host || i + 1}`}
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
