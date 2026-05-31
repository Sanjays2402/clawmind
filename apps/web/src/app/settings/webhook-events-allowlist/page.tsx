'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  type WebhookEvent,
  type WebhookEventsAllowlistRecord,
} from '@/lib/api';
import {
  ErrorState,
  Spinner,
  IconShield,
  IconWebhook,
  IconCheck,
  IconWarning,
  IconArrowRight,
  IconSettings,
} from '@clawmind/ui';

// Workspace-managed allowlist over which webhook *event types* may be
// subscribed to. Companion control to the destination allowlist: this
// page restricts the *subjects* a tenant can attach a sink to so a
// compromised admin cannot register a webhook for ask.completed and
// exfiltrate every answer (including PII) the moment they are generated.

const EVENT_DESCRIPTIONS: Record<WebhookEvent, string> = {
  'ask.completed': 'Full question, generated answer, and cited sources for every ask. High-sensitivity payload.',
  'ingest.completed': 'Notification that a document or batch finished embedding. Metadata only.',
  'audit.event': 'Workspace-wide audit log fan-out for SIEM forwarding. Includes actor and action.',
};

export default function WebhookEventsAllowlistPage() {
  const [record, setRecord] = useState<WebhookEventsAllowlistRecord | null>(null);
  const [catalogue, setCatalogue] = useState<WebhookEvent[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [chosen, setChosen] = useState<Set<WebhookEvent>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ field: string | null; message: string } | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.webhookEventsAllowlistGet();
      setRecord(res.record);
      setCatalogue(res.events);
      setEnabled(res.record.enabled);
      setChosen(new Set(res.record.events));
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

  const toggle = (e: WebhookEvent) => {
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(e)) n.delete(e);
      else n.add(e);
      return n;
    });
    setSavedAt(null);
  };

  const dirty = (() => {
    if (!record) return false;
    if (record.enabled !== enabled) return true;
    if (record.events.length !== chosen.size) return true;
    for (const e of record.events) if (!chosen.has(e)) return true;
    return false;
  })();

  const canEnable = chosen.size > 0;

  const save = async () => {
    if (!record) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Order the events to match the catalogue for stable storage / audit diffs.
      const ordered = catalogue.filter((e) => chosen.has(e));
      const next = await api.webhookEventsAllowlistPut({ enabled, events: ordered });
      setRecord(next);
      setEnabled(next.enabled);
      setChosen(new Set(next.events));
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
                Webhook event allowlist
              </h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Restrict which webhook event subjects can be subscribed to
                at all. When enforced, a webhook that asks for an event
                outside the list is rejected at registration, blocked on
                update, and silently dropped at delivery time if the list
                is tightened later.
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
              Loading event allowlist
            </div>
          </div>
        )}

        {!loading && error && (
          <ErrorState title="Could not load event allowlist" message={error} onRetry={load} />
        )}

        {!loading && !error && record && (
          <div className="space-y-6">
            <section className="rounded-lg border bg-card p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0 rounded-md border bg-muted/30 p-2 text-muted-foreground">
                  <IconWebhook size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <label htmlFor="enabled" className="block text-sm font-medium">
                    Enforce event allowlist
                  </label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {enabled
                      ? 'On. Webhooks that subscribe to any event not in the list below are blocked at registration, on update, and at delivery.'
                      : 'Off. Selections are saved but not enforced. Every webhook event in the catalogue remains subscribable.'}
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
                        ? 'Disable webhook event allowlist enforcement'
                        : 'Enable webhook event allowlist enforcement'
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
                  <span>Select at least one event before enforcing the allowlist.</span>
                </div>
              )}
            </section>

            <section className="rounded-lg border bg-card">
              <div className="border-b p-4">
                <h2 className="text-sm font-medium">Approved events</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {chosen.size} of {catalogue.length} events approved. Unchecked
                  events are unsubscribable while enforcement is on; in-flight
                  deliveries for revoked events stop immediately.
                </p>
              </div>
              <ul className="divide-y">
                {catalogue.map((e) => {
                  const on = chosen.has(e);
                  return (
                    <li key={e} className="flex items-start gap-3 p-4">
                      <input
                        id={`evt-${e}`}
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(e)}
                        className="mt-1 size-4 cursor-pointer"
                      />
                      <label htmlFor={`evt-${e}`} className="min-w-0 flex-1 cursor-pointer">
                        <div className="font-mono text-sm">{e}</div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {EVENT_DESCRIPTIONS[e] ?? 'Webhook event.'}
                        </p>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>

            {saveError && (
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
                  disabled={saving || !dirty || (enabled && !canEnable)}
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
