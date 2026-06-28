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
  SettingsCardSkeleton,
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

// Shared input styling: theme-aware surface + brand focus ring.
const INPUT_CLS =
  'w-full rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm text-cm-fg outline-none placeholder:text-cm-faint focus:ring-2 focus:ring-cm-accent';

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
  const filledCount = draft.filter((h) => h.host.trim().length > 0).length;
  const overLimit = limits ? hostCount > limits.maxHosts : false;
  const canEnable = hostCount > 0;

  // Live enforcement posture: success when the list is on and actually
  // covers receivers, cite-gold when on but empty (a configured gap that
  // blocks every delivery), muted when off entirely.
  const posture: 'enforced' | 'gap' | 'off' = !enabled
    ? 'off'
    : filledCount > 0
      ? 'enforced'
      : 'gap';

  return (
    <div className="min-h-screen bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="rounded-md border border-cm-border bg-cm-subtle p-2 text-cm-accent">
              <IconShield size={22} />
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Webhook destination allowlist
              </h1>
              <p className="mt-1 max-w-xl text-sm text-cm-muted">
                Restrict outbound webhook deliveries to an approved set of
                hostnames. When enabled, every webhook URL is checked at
                registration, when edited, and again on each delivery attempt.
                Use an exact host like hooks.acme.com or a wildcard suffix like
                *.events.acme.com.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-cm-muted">
            <Link
              href="/webhooks"
              className="inline-flex items-center gap-1 rounded-md border border-cm-border px-2.5 py-1.5 hover:bg-cm-subtle"
            >
              <IconWebhook size={14} />
              Webhooks
            </Link>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1 rounded-md border border-cm-border px-2.5 py-1.5 hover:bg-cm-subtle"
            >
              <IconSettings size={14} />
              Settings
            </Link>
            <Link
              href="/audit"
              className="inline-flex items-center gap-1 rounded-md border border-cm-border px-2.5 py-1.5 hover:bg-cm-subtle"
            >
              Audit log
              <IconArrowRight size={14} />
            </Link>
          </div>
        </header>

        {loading && <SettingsCardSkeleton rows={4} />}

        {!loading && error && (
          <ErrorState title="Could not load allowlist" message={error} onRetry={load} />
        )}

        {!loading && !error && record && limits && (
          <div className="space-y-6">
            {/* Live enforcement posture: the at-a-glance read an owner wants
                before they walk away from this page. */}
            {posture === 'enforced' && (
              <div className="flex items-start gap-2 rounded-md border border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] p-3 text-xs text-cm-success">
                <IconCheck size={14} className="mt-0.5 shrink-0" />
                <span>
                  Enforced. Outbound deliveries are restricted to{' '}
                  {filledCount} approved {filledCount === 1 ? 'host' : 'hosts'};
                  any webhook pointed elsewhere is blocked at registration and on
                  every delivery.
                </span>
              </div>
            )}
            {posture === 'gap' && (
              <div className="flex items-start gap-2 rounded-md border border-cm-cite-line bg-cm-cite-bg p-3 text-xs text-cm-cite">
                <IconWarning size={14} className="mt-0.5 shrink-0" />
                <span>
                  Enforcement is on with an empty list. Add at least one host
                  below, or no outbound webhook will be permitted to deliver.
                </span>
              </div>
            )}
            {posture === 'off' && (
              <div className="flex items-start gap-2 rounded-md border border-cm-border bg-cm-subtle p-3 text-xs text-cm-muted">
                <IconWebhook size={14} className="mt-0.5 shrink-0" />
                <span>
                  Not enforced. The list is saved for reference but any
                  destination is currently allowed. Turn enforcement on once it
                  covers every receiver you use.
                </span>
              </div>
            )}

            <section className="rounded-lg border border-cm-border bg-cm-paper p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0 rounded-md border border-cm-border bg-cm-subtle p-2 text-cm-muted">
                  <IconWebhook size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <label htmlFor="enabled" className="block text-sm font-medium">
                    Enforce allowlist
                  </label>
                  <p className="mt-0.5 text-xs text-cm-muted">
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
                    style={
                      enabled
                        ? { background: 'var(--cm-accent)', borderColor: 'var(--cm-accent)' }
                        : undefined
                    }
                    className={[
                      'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-cm-accent focus-visible:ring-offset-2 focus-visible:ring-offset-cm-bg',
                      'disabled:cursor-not-allowed disabled:opacity-60',
                      enabled ? '' : 'bg-cm-subtle border-cm-border',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'inline-block size-5 transform rounded-full bg-cm-paper shadow transition-transform',
                        enabled ? 'translate-x-5' : 'translate-x-0.5',
                      ].join(' ')}
                    />
                  </button>
                </div>
              </div>
              {enabled && !canEnable && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-cm-cite-line bg-cm-cite-bg p-3 text-xs text-cm-cite">
                  <IconWarning size={14} />
                  <span>Add at least one host before enforcing the allowlist.</span>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-cm-border bg-cm-paper">
              <div className="flex items-center justify-between border-b border-cm-border p-4">
                <div>
                  <h2 className="text-sm font-medium">Approved hosts</h2>
                  <p className="mt-0.5 text-xs text-cm-muted">
                    {hostCount} of {limits.maxHosts} hosts. Use an exact name
                    (hooks.acme.com) or a wildcard suffix (*.events.acme.com).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addHost}
                  disabled={hostCount >= limits.maxHosts}
                  className="inline-flex items-center gap-1 rounded-md border border-cm-border px-2.5 py-1.5 text-xs hover:bg-cm-subtle disabled:cursor-not-allowed disabled:opacity-60"
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
                <ul className="divide-y divide-cm-border">
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
                            className={`${INPUT_CLS} font-mono`}
                          />
                          {fieldErr && (
                            <p className="mt-1 text-xs text-cm-danger">{fieldErr}</p>
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
                            className={INPUT_CLS}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeHost(h.id)}
                          aria-label={`Remove host ${h.host || i + 1}`}
                          className="inline-flex shrink-0 items-center justify-center rounded-md border border-cm-border p-2 text-cm-muted transition hover:border-[var(--cm-danger)] hover:bg-[rgba(180,66,60,0.10)] hover:text-cm-danger"
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
              <div className="flex items-start gap-2 rounded-md border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] p-3 text-xs text-cm-danger">
                <IconWarning size={14} />
                <span>{saveError.message}</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-cm-muted">
                {savedAt !== null && !dirty ? (
                  <span className="inline-flex items-center gap-1 text-cm-success">
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
                  className="rounded-md border border-cm-border px-3 py-1.5 text-xs hover:bg-cm-subtle disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !dirty || overLimit || (enabled && !canEnable)}
                  className="inline-flex items-center gap-2 rounded-md bg-cm-fg px-3 py-1.5 text-xs font-medium text-cm-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
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
