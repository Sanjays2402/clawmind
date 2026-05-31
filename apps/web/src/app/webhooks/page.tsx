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

const ALL_EVENTS: WebhookEvent[] = ['ask.completed', 'ingest.completed'];

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
                  </tr>
                </thead>
                <tbody className="text-cm-fg">
                  {deliveries.map((d) => (
                    <tr key={d.id} className="border-t border-cm-border">
                      <td className="px-3 py-2 text-cm-muted">{fmtRelative(d.ts)}</td>
                      <td className="px-3 py-2 font-mono">{d.event}</td>
                      <td className={['px-3 py-2 font-mono', d.ok ? 'text-emerald-500' : 'text-rose-500'].join(' ')}>
                        {d.status ?? d.error ?? 'n/a'}
                      </td>
                      <td className="px-3 py-2 text-cm-muted">{d.attempt}</td>
                      <td className="px-3 py-2 text-cm-muted">{d.durationMs}ms</td>
                      <td className="px-3 py-2 font-mono text-cm-muted">{d.url}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
