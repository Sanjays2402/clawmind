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
  SettingsCardSkeleton,
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

// Events whose payload carries user content or PII. When one of these is
// approved while enforcement is on we surface a gold caution chip so an
// owner can see at a glance that a sensitive subject is reachable.
const SENSITIVE_EVENTS: ReadonlySet<WebhookEvent> = new Set<WebhookEvent>([
  'ask.completed',
  'audit.event',
]);

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

  // How many approved events carry sensitive content while enforcement is
  // live. Drives the posture banner so an owner reads the data-exposure
  // surface, not just the on/off bit.
  const sensitiveApproved = Array.from(chosen).filter((e) => SENSITIVE_EVENTS.has(e)).length;

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
                Webhook event allowlist
              </h1>
              <p className="mt-1 max-w-xl text-sm text-cm-muted">
                Restrict which webhook event subjects can be subscribed to
                at all. When enforced, a webhook that asks for an event
                outside the list is rejected at registration, blocked on
                update, and silently dropped at delivery time if the list
                is tightened later.
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
          <ErrorState title="Could not load event allowlist" message={error} onRetry={load} />
        )}

        {!loading && !error && record && (
          <div className="space-y-6">
            {/* Posture banner: lead with the data-exposure surface, not just
                the on/off bit, since these subjects carry user content. */}
            {enabled && canEnable && sensitiveApproved > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-cm-cite-line bg-cm-cite-bg p-3 text-xs text-cm-cite">
                <IconWarning size={14} className="mt-0.5 shrink-0" />
                <span>
                  Enforced with {chosen.size} approved{' '}
                  {chosen.size === 1 ? 'event' : 'events'}, {sensitiveApproved} of
                  which {sensitiveApproved === 1 ? 'carries' : 'carry'} user
                  content or audit detail. Keep the receiver allowlist tight for
                  these subjects.
                </span>
              </div>
            )}
            {enabled && canEnable && sensitiveApproved === 0 && (
              <div className="flex items-start gap-2 rounded-md border border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] p-3 text-xs text-cm-success">
                <IconCheck size={14} className="mt-0.5 shrink-0" />
                <span>
                  Enforced with {chosen.size} approved{' '}
                  {chosen.size === 1 ? 'event' : 'events'}, all metadata-only. No
                  high-sensitivity subject is currently subscribable.
                </span>
              </div>
            )}
            {!enabled && (
              <div className="flex items-start gap-2 rounded-md border border-cm-border bg-cm-subtle p-3 text-xs text-cm-muted">
                <IconWebhook size={14} className="mt-0.5 shrink-0" />
                <span>
                  Not enforced. Every event in the catalogue remains subscribable.
                  Selections below are saved for reference until you turn
                  enforcement on.
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
                    Enforce event allowlist
                  </label>
                  <p className="mt-0.5 text-xs text-cm-muted">
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
                  <span>Select at least one event before enforcing the allowlist.</span>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-cm-border bg-cm-paper">
              <div className="border-b border-cm-border p-4">
                <h2 className="text-sm font-medium">Approved events</h2>
                <p className="mt-0.5 text-xs text-cm-muted">
                  {chosen.size} of {catalogue.length} events approved. Unchecked
                  events are unsubscribable while enforcement is on; in-flight
                  deliveries for revoked events stop immediately.
                </p>
              </div>
              <ul className="divide-y divide-cm-border">
                {catalogue.map((e) => {
                  const on = chosen.has(e);
                  const sensitive = SENSITIVE_EVENTS.has(e);
                  return (
                    <li
                      key={e}
                      className={[
                        'flex items-start gap-3 p-4 transition-colors',
                        on ? 'bg-cm-accent-soft' : '',
                      ].join(' ')}
                    >
                      <input
                        id={`evt-${e}`}
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(e)}
                        className="mt-1 size-4 cursor-pointer accent-cm-accent"
                      />
                      <label htmlFor={`evt-${e}`} className="min-w-0 flex-1 cursor-pointer">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm">{e}</span>
                          {sensitive && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-cm-cite-line bg-cm-cite-bg px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cm-cite">
                              <IconWarning size={10} />
                              Sensitive
                            </span>
                          )}
                          {on && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-cm-accent-line bg-cm-accent-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cm-accent-ink">
                              <IconCheck size={10} />
                              Approved
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-cm-muted">
                          {EVENT_DESCRIPTIONS[e] ?? 'Webhook event.'}
                        </p>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>

            {saveError && (
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
                  disabled={saving || !dirty || (enabled && !canEnable)}
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
