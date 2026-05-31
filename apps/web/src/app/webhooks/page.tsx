'use client';
import { useCallback, useEffect, useState } from 'react';
import { TopNav } from '@/components/TopNav';
import { api, fmtRelative, type Webhook, type WebhookDelivery, type WebhookEvent } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconWebhook,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconCopy,
  IconCheck,
  IconWarning,
} from '@clawmind/ui';

const ALL_EVENTS: WebhookEvent[] = ['ask.completed', 'ingest.completed', 'audit.event'];

export default function WebhooksPage() {
  const [items, setItems] = useState<Webhook[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [url, setUrl] = useState('');
  const [chosen, setChosen] = useState<WebhookEvent[]>(['ask.completed']);
  const [creating, setCreating] = useState(false);

  const [issued, setIssued] = useState<Webhook | null>(null);
  const [copied, setCopied] = useState(false);

  const [busy, setBusy] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<WebhookDelivery | null>(null);
  const [redeliverBusy, setRedeliverBusy] = useState<string | null>(null);
  const [redeliverError, setRedeliverError] = useState<string | null>(null);
  const [redeliverResult, setRedeliverResult] = useState<WebhookDelivery | null>(null);
  // Holds the freshly minted secret + grace expiry after a successful
  // rotation. The secret value is shown exactly once and then cleared on
  // dismiss; subsequent list reads only carry the expiry.
  const [rotated, setRotated] = useState<{ id: string; secret: string; expiresAt: number | null } | null>(null);
  const [rotateCopied, setRotateCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, dl] = await Promise.all([
        api.webhooksList(),
        api.webhookDeliveries(undefined, 25),
      ]);
      setItems(list);
      setDeliveries(dl);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || creating || chosen.length === 0) return;
    setCreating(true);
    setError(null);
    setIssued(null);
    try {
      const wh = await api.webhookCreate({ url: url.trim(), events: chosen });
      setIssued(wh);
      setUrl('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function toggle(id: string, active: boolean) {
    setBusy(id);
    try {
      await api.webhookUpdate(id, { active: !active });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this webhook? Future events will not be delivered.')) return;
    setBusy(id);
    try {
      await api.webhookDelete(id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function fireTest(id: string) {
    setBusy(id);
    setTestResult(null);
    try {
      const res = await api.webhookTest(id);
      setTestResult(res);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // Rotate the signing secret. We confirm first because rotation forces
  // every consumer of this webhook to redeploy with the new secret before
  // the grace window closes; doing it by accident would silently break the
  // integration in 24 hours.
  async function rotate(id: string) {
    if (!confirm('Rotate the signing secret? The current secret will keep working for 24 hours so you can roll your receiver, then it stops being accepted.')) return;
    setBusy(id);
    setError(null);
    setRotated(null);
    try {
      const res = await api.webhookRotateSecret(id);
      setRotated({ id, secret: res.webhook.secret ?? '', expiresAt: res.previousSecretExpiresAt });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function copyRotated() {
    if (!rotated?.secret) return;
    await navigator.clipboard.writeText(rotated.secret);
    setRotateCopied(true);
    setTimeout(() => setRotateCopied(false), 1500);
  }

  // Replay a past delivery. Fires the original event payload at the
  // webhook's current URL; the new attempt shows up at the top of the
  // deliveries table once the list refreshes.
  async function redeliverOne(deliveryId: string) {
    setRedeliverBusy(deliveryId);
    setRedeliverError(null);
    setRedeliverResult(null);
    try {
      const res = await api.webhookRedeliver(deliveryId);
      setRedeliverResult(res);
      await load();
    } catch (err) {
      const msg = (err as Error).message;
      // Surface the structured errors the API returns so the user knows
      // why a replay was refused rather than seeing a generic toast.
      if (msg.includes('no_payload')) {
        setRedeliverError('This delivery was logged before redeliver shipped, so the original payload is gone. Fire a fresh event to enable replay.');
      } else if (msg.includes('webhook_gone')) {
        setRedeliverError('The webhook this delivery belonged to was deleted.');
      } else if (msg.includes('not_found')) {
        setRedeliverError('Delivery not found.');
      } else {
        setRedeliverError(msg);
      }
    } finally {
      setRedeliverBusy(null);
    }
  }

  async function copySecret() {
    if (!issued?.secret) return;
    await navigator.clipboard.writeText(issued.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="min-h-screen bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto w-full max-w-[1180px] px-6 py-8 sm:px-10">
        <header className="mb-6 flex items-center gap-3">
          <IconWebhook size={22} />
          <div>
            <h1 className="cm-serif text-[22px] font-medium tracking-tight">Webhooks</h1>
            <p className="text-[13px] text-cm-muted">
              Get a real HTTPS POST when something happens in your workspace. Each delivery is signed and retried on transient failures.
            </p>
          </div>
        </header>

        {error && (
          <div className="mb-4">
            <ErrorState title="Something went wrong" message={error} onRetry={load} />
          </div>
        )}

        <section className="mb-8 rounded-lg border border-cm-border bg-cm-panel p-5">
          <h2 className="mb-3 text-[13px] font-medium text-cm-fg">Register a receiver</h2>
          <form onSubmit={create} className="flex flex-col gap-3">
            <label className="text-[12px] text-cm-muted">
              Receiver URL
              <input
                type="url"
                required
                placeholder="https://example.com/webhooks/clawmind"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="mt-1 w-full rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-[13px] text-cm-fg focus:border-cm-accent focus:outline-none"
              />
            </label>
            <p className="text-[11px] text-cm-muted">
              Public HTTPS receivers only. Loopback, RFC1918, link-local, and cloud metadata addresses are blocked at registration and on every delivery attempt.
            </p>
            <fieldset>
              <legend className="text-[12px] text-cm-muted">Events</legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {ALL_EVENTS.map((ev) => {
                  const on = chosen.includes(ev);
                  return (
                    <button
                      type="button"
                      key={ev}
                      onClick={() => setChosen((c) => (c.includes(ev) ? c.filter((x) => x !== ev) : [...c, ev]))}
                      className={[
                        'rounded-md border px-2.5 py-1 text-[12px] transition-colors',
                        on
                          ? 'border-cm-accent bg-cm-accent-soft text-cm-fg'
                          : 'border-cm-border text-cm-muted hover:text-cm-fg',
                      ].join(' ')}
                    >
                      {ev}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={creating || !url.trim() || chosen.length === 0}
                className="inline-flex items-center gap-1.5 rounded-md bg-cm-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
              >
                {creating ? <Spinner size={14} /> : <IconPlus size={14} />}
                Create webhook
              </button>
              <button
                type="button"
                onClick={load}
                className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2.5 py-1.5 text-[12px] text-cm-muted hover:text-cm-fg"
              >
                <IconRefresh size={13} />
                Refresh
              </button>
            </div>
          </form>

          {issued?.secret && (
            <div className="mt-4 rounded-md border border-cm-accent bg-cm-accent-soft p-3">
              <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-cm-fg">
                <IconWarning size={14} />
                Save this signing secret. It is shown once.
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-cm-bg px-2 py-1 font-mono text-[12px] text-cm-fg">{issued.secret}</code>
                <button
                  type="button"
                  onClick={copySecret}
                  className="inline-flex items-center gap-1 rounded-md border border-cm-border px-2 py-1 text-[12px] text-cm-muted hover:text-cm-fg"
                >
                  {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="mt-2 text-[12px] text-cm-muted">
                Every POST carries header <code className="font-mono">X-ClawMind-Signature: t=&lt;ms&gt;,v1=&lt;hmac_sha256(secret, t + &quot;.&quot; + body)&gt;</code>.
              </p>
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-[13px] font-medium text-cm-fg">Your webhooks</h2>
          {loading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<IconWebhook size={28} />}
              title="No webhooks yet"
              body="Register a URL above to receive a signed POST for every matching event."
            />
          ) : (
            <ul className="divide-y divide-cm-border rounded-lg border border-cm-border bg-cm-panel">
              {items.map((wh) => (
                <li key={wh.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={[
                        'inline-block h-2 w-2 rounded-full',
                        wh.active ? 'bg-emerald-500' : 'bg-cm-muted',
                      ].join(' ')} />
                      <code className="truncate font-mono text-[13px] text-cm-fg">{wh.url}</code>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-cm-muted">
                      {wh.events.map((e) => (
                        <span key={e} className="rounded bg-cm-bg px-1.5 py-0.5">{e}</span>
                      ))}
                      <span>last delivery {fmtRelative(wh.lastDeliveryAt)}</span>
                      {wh.lastStatus !== null && <span>status {wh.lastStatus}</span>}
                      {wh.failureCount > 0 && <span className="text-amber-500">{wh.failureCount} failing</span>}
                      {wh.previousSecretExpiresAt && wh.previousSecretExpiresAt > Date.now() && (
                        <span
                          className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-500"
                          title={`Old secret accepted until ${new Date(wh.previousSecretExpiresAt).toLocaleString()}`}
                        >
                          rotating, old secret ok until {fmtRelative(wh.previousSecretExpiresAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fireTest(wh.id)}
                      disabled={busy === wh.id}
                      className="rounded-md border border-cm-border px-2.5 py-1 text-[12px] text-cm-muted hover:text-cm-fg disabled:opacity-50"
                    >
                      Send test
                    </button>
                    <button
                      type="button"
                      onClick={() => rotate(wh.id)}
                      disabled={busy === wh.id}
                      title="Generate a new signing secret. The old one keeps working for 24 hours."
                      className="inline-flex items-center gap-1 rounded-md border border-cm-border px-2.5 py-1 text-[12px] text-cm-muted hover:text-cm-fg disabled:opacity-50"
                    >
                      <IconRefresh size={12} />
                      Rotate secret
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle(wh.id, wh.active)}
                      disabled={busy === wh.id}
                      className="rounded-md border border-cm-border px-2.5 py-1 text-[12px] text-cm-muted hover:text-cm-fg disabled:opacity-50"
                    >
                      {wh.active ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(wh.id)}
                      disabled={busy === wh.id}
                      className="inline-flex items-center gap-1 rounded-md border border-cm-border px-2.5 py-1 text-[12px] text-cm-muted hover:text-rose-500 disabled:opacity-50"
                    >
                      <IconTrash size={13} />
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {rotated && (
          <section
            role="dialog"
            aria-label="New signing secret"
            className="mt-6 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4"
          >
            <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-cm-fg">
              <IconWarning size={14} />
              New signing secret. Copy it now, it will not be shown again.
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-cm-bg px-2 py-1 font-mono text-[12px] text-cm-fg">{rotated.secret}</code>
              <button
                type="button"
                onClick={copyRotated}
                className="inline-flex items-center gap-1 rounded-md border border-cm-border px-2 py-1 text-[12px] text-cm-muted hover:text-cm-fg"
              >
                {rotateCopied ? <IconCheck size={13} /> : <IconCopy size={13} />}
                {rotateCopied ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={() => setRotated(null)}
                className="rounded-md border border-cm-border px-2 py-1 text-[12px] text-cm-muted hover:text-cm-fg"
              >
                Dismiss
              </button>
            </div>
            {rotated.expiresAt && (
              <p className="mt-2 text-[12px] text-cm-muted">
                Deliveries during the grace window carry both <code className="font-mono">x-clawmind-signature</code> (new) and <code className="font-mono">x-clawmind-signature-prev</code> (old). The old secret stops being accepted at {new Date(rotated.expiresAt).toLocaleString()}.
              </p>
            )}
          </section>
        )}

        {testResult && (
          <section className="mt-6 rounded-lg border border-cm-border bg-cm-panel p-4">
            <h3 className="mb-2 text-[12px] font-medium text-cm-fg">Last test fire</h3>
            <div className="font-mono text-[12px] text-cm-muted">
              attempt {testResult.attempt} {' '}
              {testResult.status !== null ? `HTTP ${testResult.status}` : 'no response'} {' '}
              in {testResult.durationMs}ms {' '}
              {testResult.ok ? 'ok' : `failed${testResult.error ? `: ${testResult.error}` : ''}`}
            </div>
          </section>
        )}

        <section className="mt-8">
          <h2 className="mb-3 text-[13px] font-medium text-cm-fg">Recent deliveries</h2>
          {redeliverError && (
            <div className="mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
              {redeliverError}
            </div>
          )}
          {redeliverResult && (
            <div className="mb-3 rounded-md border border-cm-border bg-cm-panel px-3 py-2 text-[12px] text-cm-muted">
              Replayed: attempt {redeliverResult.attempt}{' '}
              {redeliverResult.status !== null ? `HTTP ${redeliverResult.status}` : 'no response'} in {redeliverResult.durationMs}ms{' '}
              {redeliverResult.ok ? (
                <span className="text-emerald-400">ok</span>
              ) : (
                <span className="text-rose-400">failed{redeliverResult.error ? `: ${redeliverResult.error}` : ''}</span>
              )}
            </div>
          )}
          {deliveries.length === 0 ? (
            <EmptyState
              icon={<IconRefresh size={26} />}
              title="No deliveries yet"
              body="Trigger an ask or fire a test to see a row appear here."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-cm-border bg-cm-panel">
              <table className="w-full text-left text-[12px]">
                <thead className="text-cm-muted">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Event</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Attempt</th>
                    <th className="px-3 py-2">Duration</th>
                    <th className="px-3 py-2">URL</th>
                    <th className="px-3 py-2 text-right">Replay</th>
                  </tr>
                </thead>
                <tbody className="text-cm-fg">
                  {deliveries.map((d) => {
                    const canReplay = typeof d.payload !== 'undefined' && !d.parentId;
                    const isBusy = redeliverBusy === d.id;
                    return (
                      <tr key={d.id} className="border-t border-cm-border">
                        <td className="px-3 py-2 text-cm-muted">
                          {fmtRelative(d.ts)}
                          {d.parentId && (
                            <span className="ml-2 rounded bg-cm-bg px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-cm-muted">replay</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono">{d.event}</td>
                        <td className={['px-3 py-2 font-mono', d.ok ? 'text-emerald-500' : 'text-rose-500'].join(' ')}>
                          {d.status ?? d.error ?? 'n/a'}
                        </td>
                        <td className="px-3 py-2 text-cm-muted">{d.attempt}</td>
                        <td className="px-3 py-2 text-cm-muted">{d.durationMs}ms</td>
                        <td className="px-3 py-2 font-mono text-cm-muted">{d.url}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => redeliverOne(d.id)}
                            disabled={!canReplay || isBusy}
                            title={canReplay ? 'Fire this exact payload at the webhook again' : d.parentId ? 'This row is already a replay' : 'No stored payload to replay'}
                            className="inline-flex items-center gap-1 rounded-md border border-cm-border bg-cm-bg px-2 py-1 text-[11px] text-cm-fg transition hover:border-cm-fg/40 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {isBusy ? <Spinner /> : <IconRefresh size={12} />}
                            <span>{isBusy ? 'Sending' : 'Redeliver'}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
