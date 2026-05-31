'use client';
import { useCallback, useEffect, useState } from 'react';
import { TopNav } from '@/components/TopNav';
import { api, fmtRelative, type ApiKey } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconKey,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconCopy,
  IconCheck,
  IconWarning,
} from '@clawmind/ui';

type TtlChoice = 'never' | '1d' | '7d' | '30d' | '90d' | '1y';

const TTL_MS: Record<Exclude<TtlChoice, 'never'>, number> = {
  '1d': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
  '90d': 90 * 86_400_000,
  '1y': 365 * 86_400_000,
};

export default function KeysPage() {
  const [items, setItems] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [label, setLabel] = useState('');
  const [role, setRole] = useState<'owner' | 'reader'>('reader');
  const [ttl, setTtl] = useState<TtlChoice>('never');
  const [scopesText, setScopesText] = useState('');
  const [creating, setCreating] = useState(false);

  const [issued, setIssued] = useState<{ secret: string; key: ApiKey } | null>(null);
  const [copied, setCopied] = useState(false);

  const [revoking, setRevoking] = useState<string | null>(null);
  const [rotating, setRotating] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.keysList());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || creating) return;
    setCreating(true);
    setError(null);
    setIssued(null);
    try {
      const scopes = scopesText
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await api.keyIssue({
        label: label.trim(),
        role,
        scopes: scopes.length ? scopes : undefined,
        ttlMs: ttl === 'never' ? null : TTL_MS[ttl],
      });
      setIssued(res);
      setLabel('');
      setScopesText('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function copy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this key? Clients using it will stop working immediately.')) return;
    setRevoking(id);
    try {
      await api.keyRevoke(id);
      setItems((cur) => cur.map((k) => (k.id === id ? { ...k, revokedAt: Date.now() } : k)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRevoking(null);
    }
  }

  async function rotate(id: string) {
    if (!confirm('Rotate this key? The current secret keeps working for a short grace window so you can swap it in.')) return;
    setRotating(id);
    setError(null);
    setIssued(null);
    try {
      const res = await api.keyRotate(id);
      setIssued({ secret: res.secret, key: res.key });
      setItems((cur) => cur.map((k) => (k.id === id ? res.key : k)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRotating(null);
    }
  }

  const active = items.filter((k) => !k.revokedAt);
  const revoked = items.filter((k) => k.revokedAt);

  return (
    <main className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
            <p className="mt-1 text-sm text-cm-muted">
              Programmatic access for the CLI, watcher daemon, or scripts. Secrets are shown once.
            </p>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 self-start rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
          >
            <IconRefresh size={14} /> Refresh
          </button>
        </div>

        <form onSubmit={create} className="mt-5 cm-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <IconPlus size={16} /> Issue a key
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-cm-muted">
              Label
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. watcher on laptop"
                maxLength={80}
                className="rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm text-cm-fg focus:outline-none focus:ring-2 focus:ring-cm-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-cm-muted">
              Role
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'owner' | 'reader')}
                className="rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm text-cm-fg focus:outline-none focus:ring-2 focus:ring-cm-accent"
              >
                <option value="reader">reader (read only)</option>
                <option value="owner">owner (full access)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-cm-muted">
              Expires
              <select
                value={ttl}
                onChange={(e) => setTtl(e.target.value as TtlChoice)}
                className="rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm text-cm-fg focus:outline-none focus:ring-2 focus:ring-cm-accent"
              >
                <option value="never">never</option>
                <option value="1d">in 1 day</option>
                <option value="7d">in 7 days</option>
                <option value="30d">in 30 days</option>
                <option value="90d">in 90 days</option>
                <option value="1y">in 1 year</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-cm-muted">
              Scopes (optional)
              <input
                value={scopesText}
                onChange={(e) => setScopesText(e.target.value)}
                placeholder="search:read, ingest:write"
                className="rounded-md border border-cm-border bg-cm-bg px-3 py-2 font-mono text-sm text-cm-fg focus:outline-none focus:ring-2 focus:ring-cm-accent"
              />
            </label>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-cm-muted">
              Scopes use <code className="font-mono">resource:action</code>. Leave blank for unrestricted within the role.
            </p>
            <button
              type="submit"
              disabled={creating || !label.trim()}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-cm-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {creating ? <Spinner size={14} /> : <IconKey size={14} />}
              Issue key
            </button>
          </div>
        </form>

        {issued && (
          <div className="mt-4 cm-card border-cm-accent/40 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <IconWarning size={16} className="text-cm-accent" />
              Copy this secret now. It will not be shown again.
            </div>
            <div className="mt-3 flex items-stretch gap-2">
              <code className="flex-1 overflow-x-auto rounded-md border border-cm-border bg-cm-bg px-3 py-2 font-mono text-sm">
                {issued.secret}
              </code>
              <button
                onClick={copy}
                className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-2 text-sm hover:text-cm-fg"
              >
                {copied ? <IconCheck size={14} className="text-cm-success" /> : <IconCopy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-cm-muted">
              <span>label: {issued.key.label} | role: {issued.key.role}</span>
              <button onClick={() => setIssued(null)} className="hover:text-cm-fg">dismiss</button>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4">
            <ErrorState message={error} onRetry={() => setError(null)} retryLabel="Dismiss" />
          </div>
        )}

        <section className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-cm-muted">Active</h2>
          {loading && items.length === 0 ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : active.length === 0 ? (
            <EmptyState
              title="No active keys"
              body="Issue a key above to use the API from a script, the CLI, or the watcher daemon."
            />
          ) : (
            <ul className="cm-card divide-y divide-cm-border">
              {active.map((k) => (
                <KeyRow
                  key={k.id}
                  k={k}
                  onRevoke={revoke}
                  onRotate={rotate}
                  revoking={revoking === k.id}
                  rotating={rotating === k.id}
                />
              ))}
            </ul>
          )}
        </section>

        {revoked.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-medium text-cm-muted">Revoked</h2>
            <ul className="cm-card divide-y divide-cm-border opacity-70">
              {revoked.map((k) => (
                <KeyRow
                  key={k.id}
                  k={k}
                  onRevoke={revoke}
                  onRotate={rotate}
                  revoking={false}
                  rotating={false}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

function KeyRow({
  k,
  onRevoke,
  onRotate,
  revoking,
  rotating,
}: {
  k: ApiKey;
  onRevoke: (id: string) => void;
  onRotate: (id: string) => void;
  revoking: boolean;
  rotating: boolean;
}) {
  const expired = k.expiresAt != null && k.expiresAt < Date.now();
  const status = k.revokedAt ? 'revoked' : expired ? 'expired' : 'active';
  const graceActive = k.previousHashExpiresAt != null && k.previousHashExpiresAt > Date.now();
  return (
    <li className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <IconKey size={14} className="text-cm-muted" />
          <span className="truncate text-sm font-medium">{k.label}</span>
          <span className="rounded-md border border-cm-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-cm-muted">
            {k.role}
          </span>
          <span
            className={[
              'rounded-md px-1.5 py-0.5 text-[10px] uppercase tracking-wide',
              status === 'active' ? 'bg-cm-success/15 text-cm-success'
                : status === 'expired' ? 'bg-cm-danger/15 text-cm-danger'
                : 'bg-cm-border text-cm-muted',
            ].join(' ')}
          >
            {status}
          </span>
          {graceActive && (
            <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-500">
              old secret valid {fmtRelative(k.previousHashExpiresAt!)}
            </span>
          )}
        </div>
        <div className="mt-1 font-mono text-xs text-cm-muted">{k.id}</div>
        <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-cm-muted">
          <span>created {fmtRelative(k.createdAt)}</span>
          <span>last used {fmtRelative(k.lastUsedAt)}</span>
          {k.rotatedAt && <span>rotated {fmtRelative(k.rotatedAt)}</span>}
          {k.expiresAt && <span>expires {fmtRelative(k.expiresAt)}</span>}
          {k.revokedAt && <span>revoked {fmtRelative(k.revokedAt)}</span>}
        </div>
        {k.scopes && k.scopes.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {k.scopes.map((s) => (
              <code key={s} className="rounded border border-cm-border px-1.5 py-0.5 font-mono text-[10px] text-cm-muted">{s}</code>
            ))}
          </div>
        )}
      </div>
      {!k.revokedAt && (
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => onRotate(k.id)}
            disabled={rotating || revoking}
            className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg disabled:opacity-50"
          >
            {rotating ? <Spinner size={14} /> : <IconRefresh size={14} />}
            Rotate
          </button>
          <button
            onClick={() => onRevoke(k.id)}
            disabled={revoking || rotating}
            className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-danger disabled:opacity-50"
          >
            {revoking ? <Spinner size={14} /> : <IconTrash size={14} />}
            Revoke
          </button>
        </div>
      )}
    </li>
  );
}
