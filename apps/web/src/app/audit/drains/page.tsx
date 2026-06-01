'use client';

// Audit-log SIEM drains.
//
// Workspace owners point the audit chain at one or more HTTPS sinks
// (Splunk HEC, Datadog, or a generic HMAC-signed endpoint). The server
// pushes new events in the background; this page is the configuration
// surface and the place an operator confirms a drain is healthy.

import { useCallback, useEffect, useState } from 'react';
import { TopNav } from '@/components/TopNav';
import { api, ApiError, fmtRelative } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconWebhook,
  IconShield,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconCopy,
  IconCheck,
  IconWarning,
} from '@clawmind/ui';

type Kind = 'generic' | 'splunk-hec' | 'datadog';

interface Drain {
  id: string;
  kind: Kind;
  url: string;
  enabled: boolean;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
  lastCursor: { ts: number; id: string } | null;
  lastDeliveryAt: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  delivered: number;
  dropped: number;
  secretFingerprint: string;
}

const KIND_LABEL: Record<Kind, string> = {
  generic: 'Generic HMAC',
  'splunk-hec': 'Splunk HEC',
  datadog: 'Datadog Logs',
};

export default function AuditDrainsPage() {
  const [drains, setDrains] = useState<Drain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<Kind>('generic');
  const [url, setUrl] = useState('');
  const [creating, setCreating] = useState(false);

  const [issued, setIssued] = useState<{ id: string; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [busy, setBusy] = useState<string | null>(null);
  const [rotated, setRotated] = useState<{ id: string; secret: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.auditDrainsList();
      setDrains(res.drains as Drain[]);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 401) {
        setError('Sign in as a workspace owner or admin to view audit drains.');
      } else if (status === 403) {
        setError('You do not have permission to view audit drains.');
      } else {
        setError((err as Error).message || 'Failed to load drains.');
      }
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setCreating(true);
    try {
      const res = await api.auditDrainsCreate({ kind, url: url.trim() });
      setIssued({ id: res.drain.id, secret: res.secret });
      setUrl('');
      await load();
    } catch (err) {
      setError((err as Error).message || 'Failed to create drain.');
    } finally {
      setCreating(false);
    }
  }

  async function onToggle(d: Drain) {
    setBusy(d.id);
    try {
      await api.auditDrainsUpdate(d.id, { enabled: !d.enabled });
      await load();
    } catch (err) {
      setError((err as Error).message || 'Failed to update drain.');
    } finally {
      setBusy(null);
    }
  }

  async function onFlush(d: Drain) {
    setBusy(d.id);
    try {
      await api.auditDrainsFlush(d.id);
      await load();
    } catch (err) {
      setError((err as Error).message || 'Flush failed.');
    } finally {
      setBusy(null);
    }
  }

  async function onRotate(d: Drain) {
    if (!confirm(`Rotate the shared secret for ${d.url}? The receiver must be updated immediately.`)) return;
    setBusy(d.id);
    try {
      const res = await api.auditDrainsRotate(d.id);
      setRotated({ id: d.id, secret: res.secret });
      await load();
    } catch (err) {
      setError((err as Error).message || 'Rotate failed.');
    } finally {
      setBusy(null);
    }
  }

  async function onDelete(d: Drain) {
    if (!confirm(`Delete drain ${d.url}? Audit events will stop being streamed to this destination.`)) return;
    setBusy(d.id);
    try {
      await api.auditDrainsDelete(d.id);
      await load();
    } catch (err) {
      setError((err as Error).message || 'Delete failed.');
    } finally {
      setBusy(null);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable in dev */
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <IconShield size={22} />
              Audit log drains
            </h1>
            <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
              Continuously stream the workspace audit chain to your SIEM.
              Every event is signed with HMAC-SHA256 over the raw body and
              delivered with the original hash chain intact, so a regulator
              can verify the feed has not been altered in transit.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm hover:bg-accent"
            aria-label="Refresh"
          >
            <IconRefresh size={16} />
            Refresh
          </button>
        </header>

        {issued ? (
          <div className="mb-6 rounded-lg border border-green-500/40 bg-green-500/5 p-4">
            <div className="flex items-start gap-2">
              <IconCheck size={18} className="mt-0.5 text-green-500" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Drain created. Copy the shared secret now.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This is the only time the secret is shown. Paste it into your
                  receiver as the HMAC verification key. After dismissing this
                  banner you will have to rotate the secret to see a new one.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <code className="flex-1 truncate rounded border border-border bg-background px-2 py-1 text-xs font-mono">
                    {issued.secret}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy(issued.secret)}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs hover:bg-accent"
                  >
                    {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIssued(null)}
                    className="inline-flex h-8 items-center rounded-md border border-border bg-card px-2 text-xs hover:bg-accent"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {rotated ? (
          <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
            <div className="flex items-start gap-2">
              <IconWarning size={18} className="mt-0.5 text-amber-500" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">New shared secret issued.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Update the receiver immediately. The previous secret no longer
                  authenticates outbound deliveries.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <code className="flex-1 truncate rounded border border-border bg-background px-2 py-1 text-xs font-mono">
                    {rotated.secret}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy(rotated.secret)}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs hover:bg-accent"
                  >
                    <IconCopy size={14} />
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => setRotated(null)}
                    className="inline-flex h-8 items-center rounded-md border border-border bg-card px-2 text-xs hover:bg-accent"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <section className="mb-8 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Add a drain</h2>
          <form
            onSubmit={onCreate}
            className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end"
          >
            <label className="block text-xs">
              <span className="mb-1 block text-muted-foreground">Type</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="generic">Generic HMAC</option>
                <option value="splunk-hec">Splunk HEC</option>
                <option value="datadog">Datadog Logs</option>
              </select>
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-muted-foreground">HTTPS endpoint</span>
              <input
                type="url"
                required
                placeholder="https://siem.example.com/services/collector/event"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={creating || !url.trim()}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
            >
              <IconPlus size={16} />
              {creating ? 'Creating...' : 'Add'}
            </button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            Owner role with a recent MFA step-up is required. The shared
            secret is auto-generated and shown exactly once.
          </p>
        </section>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner />
          </div>
        ) : error ? (
          <ErrorState title="Cannot load drains" message={error} />
        ) : drains.length === 0 ? (
          <EmptyState
            title="No audit drains yet"
            body="Add a destination above to begin streaming the workspace audit log to your SIEM."
            icon={<IconWebhook size={32} />}
          />
        ) : (
          <ul className="space-y-3">
            {drains.map((d) => (
              <li
                key={d.id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded border border-border bg-background px-1.5 py-0.5 text-xs">
                        {KIND_LABEL[d.kind]}
                      </span>
                      <span
                        className={
                          d.enabled
                            ? 'rounded bg-green-500/10 px-1.5 py-0.5 text-xs text-green-600 dark:text-green-400'
                            : 'rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground'
                        }
                      >
                        {d.enabled ? 'enabled' : 'disabled'}
                      </span>
                      {d.consecutiveFailures > 0 ? (
                        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-600 dark:text-amber-400">
                          {d.consecutiveFailures} failures
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 truncate text-sm font-mono">{d.url}</p>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                      <div>
                        <dt className="opacity-70">Delivered</dt>
                        <dd className="text-foreground">{d.delivered}</dd>
                      </div>
                      <div>
                        <dt className="opacity-70">Dropped</dt>
                        <dd className="text-foreground">{d.dropped}</dd>
                      </div>
                      <div>
                        <dt className="opacity-70">Last delivery</dt>
                        <dd className="text-foreground">
                          {d.lastDeliveryAt ? fmtRelative(d.lastDeliveryAt) : 'never'}
                        </dd>
                      </div>
                      <div>
                        <dt className="opacity-70">Secret fingerprint</dt>
                        <dd className="font-mono text-foreground">{d.secretFingerprint}</dd>
                      </div>
                    </dl>
                    {d.lastError ? (
                      <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                        Last error: {d.lastError}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onFlush(d)}
                      disabled={busy === d.id || !d.enabled}
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs hover:bg-accent disabled:opacity-50"
                    >
                      <IconRefresh size={14} />
                      Flush now
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggle(d)}
                      disabled={busy === d.id}
                      className="inline-flex h-8 items-center rounded-md border border-border bg-card px-2 text-xs hover:bg-accent disabled:opacity-50"
                    >
                      {d.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRotate(d)}
                      disabled={busy === d.id}
                      className="inline-flex h-8 items-center rounded-md border border-border bg-card px-2 text-xs hover:bg-accent disabled:opacity-50"
                    >
                      Rotate secret
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(d)}
                      disabled={busy === d.id}
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-red-500/40 bg-red-500/5 px-2 text-xs text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                    >
                      <IconTrash size={14} />
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
