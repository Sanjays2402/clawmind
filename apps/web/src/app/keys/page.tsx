'use client';
import { useCallback, useEffect, useState } from 'react';
import { TopNav } from '@/components/TopNav';
import { api, fmtRelative, type ApiKey, type KeyUsageReport } from '@/lib/api';
import { CurlExamples } from './CurlExamples';
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
  IconChartBar,
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
  const [policy, setPolicy] = useState<{ forcedRotationDays: number } | null>(null);
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
      const res = await api.keysListWithPolicy();
      setItems(res.items);
      setPolicy(res.policy);
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

        {policy && policy.forcedRotationDays > 0 && (() => {
          const overdue = items.filter((k) => k.needsRotation && !k.revokedAt).length;
          return (
            <div
              className={[
                'mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
                overdue > 0
                  ? 'border-cm-danger/40 bg-cm-danger/10 text-cm-danger'
                  : 'border-cm-border bg-cm-bg-soft text-cm-muted',
              ].join(' ')}
              role={overdue > 0 ? 'alert' : undefined}
            >
              <IconWarning size={14} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">
                  Rotation policy: every {policy.forcedRotationDays} days
                </div>
                <div className="mt-0.5">
                  {overdue > 0
                    ? `${overdue} key${overdue === 1 ? '' : 's'} past the rotation cap. The API rejects them with 401 rotation_required until rotated.`
                    : 'All active keys are within the rotation cap.'}
                </div>
              </div>
            </div>
          );
        })()}

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
            <div className="mt-4 border-t border-cm-border pt-2">
              <CurlExamples secret={issued.secret} />
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

        <CurlExamples />

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

function minutesToHHMM(min: number): string {
  const m = Math.max(0, Math.min(1440, Math.round(min)));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${String(h).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function hhmmToMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  if (h < 0 || h > 24 || mm < 0 || mm > 59) return null;
  const total = h * 60 + mm;
  if (total > 1440) return null;
  return total;
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
  const [showUsage, setShowUsage] = useState(false);
  const [usage, setUsage] = useState<KeyUsageReport | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [showLimit, setShowLimit] = useState(false);
  const [limitMax, setLimitMax] = useState(String(k.rateLimit?.max ?? 60));
  const [limitWindowSec, setLimitWindowSec] = useState(String(Math.max(1, Math.round((k.rateLimit?.windowMs ?? 60_000) / 1000))));
  const [limitSaving, setLimitSaving] = useState(false);
  const [limitError, setLimitError] = useState<string | null>(null);

  const [showIps, setShowIps] = useState(false);
  const [ipsText, setIpsText] = useState((k.allowedIps ?? []).join('\n'));
  const [ipsSaving, setIpsSaving] = useState(false);
  const [ipsError, setIpsError] = useState<string | null>(null);

  const [showOrigins, setShowOrigins] = useState(false);
  const [originsText, setOriginsText] = useState((k.allowedOrigins ?? []).join('\n'));
  const [originsSaving, setOriginsSaving] = useState(false);
  const [originsError, setOriginsError] = useState<string | null>(null);

  const [showHours, setShowHours] = useState(false);
  const initialHoursWindow = k.allowedHours?.windows?.[0];
  const [hoursTz, setHoursTz] = useState(
    k.allowedHours?.tz ?? (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'),
  );
  const [hoursDays, setHoursDays] = useState<number[]>(
    initialHoursWindow?.days ?? [1, 2, 3, 4, 5],
  );
  const [hoursStart, setHoursStart] = useState(
    minutesToHHMM(initialHoursWindow?.startMin ?? 540),
  );
  const [hoursEnd, setHoursEnd] = useState(
    minutesToHHMM(initialHoursWindow?.endMin ?? 1080),
  );
  const [hoursSaving, setHoursSaving] = useState(false);
  const [hoursError, setHoursError] = useState<string | null>(null);

  const [showMethods, setShowMethods] = useState(false);
  const ALL_METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
  const [methodSet, setMethodSet] = useState<string[]>(k.allowedMethods ?? []);
  const [methodsSaving, setMethodsSaving] = useState(false);
  const [methodsError, setMethodsError] = useState<string | null>(null);

  async function saveMethods() {
    if (methodSet.length === 0) {
      setMethodsError('pick at least one method (or click Clear to remove the restriction)');
      return;
    }
    setMethodsSaving(true);
    setMethodsError(null);
    try {
      await api.keySetAllowedMethods(k.id, [...methodSet].sort());
      setShowMethods(false);
      window.location.reload();
    } catch (err) {
      setMethodsError((err as Error).message);
    } finally {
      setMethodsSaving(false);
    }
  }

  async function clearMethods() {
    setMethodsSaving(true);
    setMethodsError(null);
    try {
      await api.keySetAllowedMethods(k.id, null);
      setMethodSet([]);
      setShowMethods(false);
      window.location.reload();
    } catch (err) {
      setMethodsError((err as Error).message);
    } finally {
      setMethodsSaving(false);
    }
  }

  async function saveHours() {
    const startMin = hhmmToMinutes(hoursStart);
    const endMin = hhmmToMinutes(hoursEnd);
    if (startMin == null || endMin == null) {
      setHoursError('start and end must be HH:MM');
      return;
    }
    if (endMin <= startMin) {
      setHoursError('end must be after start (split overnight windows)');
      return;
    }
    if (hoursDays.length === 0) {
      setHoursError('pick at least one day');
      return;
    }
    setHoursSaving(true);
    setHoursError(null);
    try {
      await api.keySetAllowedHours(k.id, {
        tz: hoursTz,
        windows: [{ days: [...hoursDays].sort((a, b) => a - b), startMin, endMin }],
      });
      setShowHours(false);
      window.location.reload();
    } catch (err) {
      setHoursError((err as Error).message);
    } finally {
      setHoursSaving(false);
    }
  }

  async function clearHours() {
    setHoursSaving(true);
    setHoursError(null);
    try {
      await api.keySetAllowedHours(k.id, null);
      setShowHours(false);
      window.location.reload();
    } catch (err) {
      setHoursError((err as Error).message);
    } finally {
      setHoursSaving(false);
    }
  }

  async function saveOrigins() {
    const parsed = originsText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    setOriginsSaving(true);
    setOriginsError(null);
    try {
      await api.keySetAllowedOrigins(k.id, parsed.length > 0 ? parsed : null);
      setShowOrigins(false);
      window.location.reload();
    } catch (err) {
      setOriginsError((err as Error).message);
    } finally {
      setOriginsSaving(false);
    }
  }

  async function clearOrigins() {
    setOriginsSaving(true);
    setOriginsError(null);
    try {
      await api.keySetAllowedOrigins(k.id, null);
      setOriginsText('');
      setShowOrigins(false);
      window.location.reload();
    } catch (err) {
      setOriginsError((err as Error).message);
    } finally {
      setOriginsSaving(false);
    }
  }

  async function saveIps() {
    const parsed = ipsText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    setIpsSaving(true);
    setIpsError(null);
    try {
      await api.keySetAllowedIps(k.id, parsed.length > 0 ? parsed : null);
      setShowIps(false);
      window.location.reload();
    } catch (err) {
      setIpsError((err as Error).message);
    } finally {
      setIpsSaving(false);
    }
  }

  async function clearIps() {
    setIpsSaving(true);
    setIpsError(null);
    try {
      await api.keySetAllowedIps(k.id, null);
      setIpsText('');
      setShowIps(false);
      window.location.reload();
    } catch (err) {
      setIpsError((err as Error).message);
    } finally {
      setIpsSaving(false);
    }
  }

  async function saveLimit() {
    const max = Number(limitMax);
    const windowSec = Number(limitWindowSec);
    if (!Number.isInteger(max) || max < 1) { setLimitError('max must be a positive integer'); return; }
    if (!Number.isInteger(windowSec) || windowSec < 1) { setLimitError('window must be at least 1 second'); return; }
    setLimitSaving(true);
    setLimitError(null);
    try {
      await api.keySetRateLimit(k.id, { max, windowMs: windowSec * 1000 });
      setShowLimit(false);
      window.location.reload();
    } catch (err) {
      setLimitError((err as Error).message);
    } finally {
      setLimitSaving(false);
    }
  }

  async function clearLimit() {
    setLimitSaving(true);
    setLimitError(null);
    try {
      await api.keySetRateLimit(k.id, null);
      setShowLimit(false);
      window.location.reload();
    } catch (err) {
      setLimitError((err as Error).message);
    } finally {
      setLimitSaving(false);
    }
  }

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    setUsageError(null);
    try {
      setUsage(await api.keyUsage(k.id, { recent: 10, routes: 6 }));
    } catch (err) {
      setUsageError((err as Error).message);
    } finally {
      setUsageLoading(false);
    }
  }, [k.id]);

  function toggleUsage() {
    const next = !showUsage;
    setShowUsage(next);
    if (next && !usage && !usageLoading) void loadUsage();
  }
  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
          {k.needsRotation && !k.revokedAt && (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-cm-danger/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-cm-danger"
              title="This key is older than the workspace rotation policy and is being denied at the auth boundary. Rotate to mint a fresh secret."
            >
              <IconWarning size={10} /> rotation required
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
          {k.rateLimit && (
            <span title="per-key rate limit">
              limit {k.rateLimit.max}/{Math.max(1, Math.round(k.rateLimit.windowMs / 1000))}s
            </span>
          )}
          {k.allowedIps && k.allowedIps.length > 0 && (
            <span title={k.allowedIps.join(', ')}>
              ip allowlist {k.allowedIps.length}
            </span>
          )}
          {k.allowedOrigins && k.allowedOrigins.length > 0 && (
            <span title={k.allowedOrigins.join(', ')}>
              origin allowlist {k.allowedOrigins.length}
            </span>
          )}
          {k.allowedHours && k.allowedHours.windows.length > 0 && (
            <span title={`${k.allowedHours.tz}, ${k.allowedHours.windows.length} window(s)`}>
              hours {k.allowedHours.tz}
            </span>
          )}
          {k.allowedMethods && k.allowedMethods.length > 0 && (
            <span title={`Wire-level: only ${k.allowedMethods.join(', ')}`}>
              methods {k.allowedMethods.join('/')}
            </span>
          )}
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
            onClick={toggleUsage}
            aria-expanded={showUsage}
            className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
          >
            <IconChartBar size={14} />
            {showUsage ? 'Hide usage' : 'Usage'}
          </button>
          <button
            onClick={() => setShowLimit((v) => !v)}
            aria-expanded={showLimit}
            className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
          >
            {showLimit ? 'Hide limit' : k.rateLimit ? 'Limit' : 'Set limit'}
          </button>
          <button
            onClick={() => setShowIps((v) => !v)}
            aria-expanded={showIps}
            className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
          >
            {showIps ? 'Hide IPs' : k.allowedIps && k.allowedIps.length > 0 ? `IPs (${k.allowedIps.length})` : 'Restrict IPs'}
          </button>
          <button
            onClick={() => setShowOrigins((v) => !v)}
            aria-expanded={showOrigins}
            className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
          >
            {showOrigins ? 'Hide origins' : k.allowedOrigins && k.allowedOrigins.length > 0 ? `Origins (${k.allowedOrigins.length})` : 'Restrict origins'}
          </button>
          <button
            onClick={() => setShowHours((v) => !v)}
            aria-expanded={showHours}
            className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
          >
            {showHours ? 'Hide hours' : k.allowedHours && k.allowedHours.windows.length > 0 ? `Hours (${k.allowedHours.tz})` : 'Restrict hours'}
          </button>
          <button
            onClick={() => setShowMethods((v) => !v)}
            aria-expanded={showMethods}
            className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
          >
            {showMethods ? 'Hide methods' : k.allowedMethods && k.allowedMethods.length > 0 ? `Methods (${k.allowedMethods.length})` : 'Restrict methods'}
          </button>
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
      </div>
      {showUsage && (
        <UsagePanel
          loading={usageLoading}
          error={usageError}
          usage={usage}
          onRetry={loadUsage}
        />
      )}
      {showLimit && (
        <div className="mt-2 rounded-md border border-cm-border p-3">
          <div className="mb-2 text-xs text-cm-muted">
            Per-key rate limit. Stricter than the global ceiling. Returns 429 with standard X-RateLimit headers when exceeded.
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-xs text-cm-muted">
              max requests
              <input
                type="number"
                min={1}
                value={limitMax}
                onChange={(e) => setLimitMax(e.target.value)}
                className="mt-1 w-28 rounded-md border border-cm-border bg-transparent px-2 py-1 text-sm text-cm-fg"
              />
            </label>
            <label className="flex flex-col text-xs text-cm-muted">
              per (seconds)
              <input
                type="number"
                min={1}
                value={limitWindowSec}
                onChange={(e) => setLimitWindowSec(e.target.value)}
                className="mt-1 w-28 rounded-md border border-cm-border bg-transparent px-2 py-1 text-sm text-cm-fg"
              />
            </label>
            <button
              onClick={saveLimit}
              disabled={limitSaving}
              className="inline-flex items-center gap-1.5 rounded-md border border-cm-border bg-cm-fg px-3 py-1.5 text-sm text-cm-bg hover:opacity-90 disabled:opacity-50"
            >
              {limitSaving ? <Spinner size={14} /> : <IconCheck size={14} />}
              Save
            </button>
            {k.rateLimit && (
              <button
                onClick={clearLimit}
                disabled={limitSaving}
                className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-danger disabled:opacity-50"
              >
                Clear
              </button>
            )}
          </div>
          {limitError && (
            <div className="mt-2 text-xs text-cm-danger">{limitError}</div>
          )}
        </div>
      )}
      {showIps && (
        <div className="mt-2 rounded-md border border-cm-border p-3">
          <div className="mb-2 text-xs text-cm-muted">
            Per-key IP allowlist. One IPv4 or IPv6 address or CIDR block per line. Requests from any other source are rejected with 403 before the call runs. Leave empty to remove the restriction.
          </div>
          <textarea
            value={ipsText}
            onChange={(e) => setIpsText(e.target.value)}
            rows={4}
            spellCheck={false}
            placeholder={'10.0.0.0/8\n203.0.113.7'}
            className="w-full rounded-md border border-cm-border bg-transparent px-2 py-1.5 font-mono text-xs text-cm-fg"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={saveIps}
              disabled={ipsSaving}
              className="inline-flex items-center gap-1.5 rounded-md border border-cm-border bg-cm-fg px-3 py-1.5 text-sm text-cm-bg hover:opacity-90 disabled:opacity-50"
            >
              {ipsSaving ? <Spinner size={14} /> : <IconCheck size={14} />}
              Save
            </button>
            {k.allowedIps && k.allowedIps.length > 0 && (
              <button
                onClick={clearIps}
                disabled={ipsSaving}
                className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-danger disabled:opacity-50"
              >
                Clear
              </button>
            )}
          </div>
          {ipsError && (
            <div className="mt-2 text-xs text-cm-danger">{ipsError}</div>
          )}
        </div>
      )}
      {showOrigins && (
        <div className="mt-2 rounded-md border border-cm-border p-3">
          <div className="mb-2 text-xs text-cm-muted">
            Per-key Origin allowlist. One scheme+host[:port] per line, for keys embedded in a first-party browser bundle. Requests with no Origin header (typical server-to-server callers) keep working unchanged. Browser requests from any other origin are rejected with 403. Leave empty to remove the restriction.
          </div>
          <textarea
            value={originsText}
            onChange={(e) => setOriginsText(e.target.value)}
            rows={4}
            spellCheck={false}
            placeholder={'https://app.example.com\nhttps://admin.example.com'}
            className="w-full rounded-md border border-cm-border bg-transparent px-2 py-1.5 font-mono text-xs text-cm-fg"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={saveOrigins}
              disabled={originsSaving}
              className="inline-flex items-center gap-1.5 rounded-md border border-cm-border bg-cm-fg px-3 py-1.5 text-sm text-cm-bg hover:opacity-90 disabled:opacity-50"
            >
              {originsSaving ? <Spinner size={14} /> : <IconCheck size={14} />}
              Save
            </button>
            {k.allowedOrigins && k.allowedOrigins.length > 0 && (
              <button
                onClick={clearOrigins}
                disabled={originsSaving}
                className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-danger disabled:opacity-50"
              >
                Clear
              </button>
            )}
          </div>
          {originsError && (
            <div className="mt-2 text-xs text-cm-danger">{originsError}</div>
          )}
        </div>
      )}
      {showHours && (
        <div className="mt-2 rounded-md border border-cm-border p-3">
          <div className="mb-2 text-xs text-cm-muted">
            Per-key time of day window. Requests outside this schedule are rejected with 403 before the call runs. Use to bind a CI key to business hours. Overnight windows: clear here and create two adjacent windows via the API.
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-xs text-cm-muted">
              timezone (IANA)
              <input
                type="text"
                value={hoursTz}
                onChange={(e) => setHoursTz(e.target.value)}
                placeholder="America/Los_Angeles"
                spellCheck={false}
                className="mt-1 w-56 rounded-md border border-cm-border bg-transparent px-2 py-1 font-mono text-xs text-cm-fg"
              />
            </label>
            <label className="flex flex-col text-xs text-cm-muted">
              start
              <input
                type="time"
                value={hoursStart}
                onChange={(e) => setHoursStart(e.target.value)}
                className="mt-1 w-28 rounded-md border border-cm-border bg-transparent px-2 py-1 text-sm text-cm-fg"
              />
            </label>
            <label className="flex flex-col text-xs text-cm-muted">
              end
              <input
                type="time"
                value={hoursEnd}
                onChange={(e) => setHoursEnd(e.target.value)}
                className="mt-1 w-28 rounded-md border border-cm-border bg-transparent px-2 py-1 text-sm text-cm-fg"
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {[
              { v: 0, label: 'Sun' },
              { v: 1, label: 'Mon' },
              { v: 2, label: 'Tue' },
              { v: 3, label: 'Wed' },
              { v: 4, label: 'Thu' },
              { v: 5, label: 'Fri' },
              { v: 6, label: 'Sat' },
            ].map((d) => {
              const on = hoursDays.includes(d.v);
              return (
                <button
                  key={d.v}
                  type="button"
                  onClick={() =>
                    setHoursDays((cur) =>
                      cur.includes(d.v) ? cur.filter((x) => x !== d.v) : [...cur, d.v],
                    )
                  }
                  className={[
                    'rounded-md border px-2 py-1 text-xs',
                    on
                      ? 'border-cm-fg bg-cm-fg text-cm-bg'
                      : 'border-cm-border text-cm-muted hover:text-cm-fg',
                  ].join(' ')}
                  aria-pressed={on}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={saveHours}
              disabled={hoursSaving}
              className="inline-flex items-center gap-1.5 rounded-md border border-cm-border bg-cm-fg px-3 py-1.5 text-sm text-cm-bg hover:opacity-90 disabled:opacity-50"
            >
              {hoursSaving ? <Spinner size={14} /> : <IconCheck size={14} />}
              Save
            </button>
            {k.allowedHours && k.allowedHours.windows.length > 0 && (
              <button
                onClick={clearHours}
                disabled={hoursSaving}
                className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-danger disabled:opacity-50"
              >
                Clear
              </button>
            )}
          </div>
          {hoursError && (
            <div className="mt-2 text-xs text-cm-danger">{hoursError}</div>
          )}
        </div>
      )}
      {showMethods && !k.revokedAt && (
        <div className="mt-3 rounded-md border border-cm-border bg-cm-bg/50 p-3">
          <div className="text-xs text-cm-muted">
            Pin this key to a subset of HTTP verbs. A request using any other method is rejected with 405 before the route handler runs, regardless of scopes. Useful for read-only exporters and webhook receivers.
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {ALL_METHODS.map((m) => {
              const on = methodSet.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() =>
                    setMethodSet((cur) =>
                      cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m],
                    )
                  }
                  className={[
                    'rounded border px-2 py-1 font-mono text-[11px]',
                    on
                      ? 'border-cm-fg bg-cm-fg text-cm-bg'
                      : 'border-cm-border text-cm-muted hover:text-cm-fg',
                  ].join(' ')}
                  aria-pressed={on}
                >
                  {m}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={saveMethods}
              disabled={methodsSaving}
              className="inline-flex items-center gap-1.5 rounded-md border border-cm-border bg-cm-fg px-3 py-1.5 text-sm text-cm-bg hover:opacity-90 disabled:opacity-50"
            >
              {methodsSaving ? <Spinner size={14} /> : <IconCheck size={14} />}
              Save
            </button>
            <button
              type="button"
              onClick={() => setMethodSet(['GET', 'HEAD'])}
              disabled={methodsSaving}
              className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg disabled:opacity-50"
            >
              Read-only preset
            </button>
            {k.allowedMethods && k.allowedMethods.length > 0 && (
              <button
                onClick={clearMethods}
                disabled={methodsSaving}
                className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-danger disabled:opacity-50"
              >
                Clear
              </button>
            )}
          </div>
          {methodsError && (
            <div className="mt-2 text-xs text-cm-danger">{methodsError}</div>
          )}
        </div>
      )}
    </li>
  );
}

function UsagePanel({
  loading,
  error,
  usage,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  usage: KeyUsageReport | null;
  onRetry: () => void;
}) {
  if (loading && !usage) {
    return (
      <div className="mt-1 flex justify-center rounded-md border border-cm-border bg-cm-bg/50 py-6">
        <Spinner />
      </div>
    );
  }
  if (error) {
    return (
      <div className="mt-1 rounded-md border border-cm-border bg-cm-bg/50 p-3">
        <ErrorState message={error} onRetry={onRetry} retryLabel="Retry" />
      </div>
    );
  }
  if (!usage) return null;
  if (usage.totals.total === 0) {
    return (
      <div className="mt-1 rounded-md border border-cm-border bg-cm-bg/50 p-3 text-xs text-cm-muted">
        No recorded requests yet. Make a call with this key and refresh.
      </div>
    );
  }
  const { totals, recent, byRoute, byIp, uniqueIps } = usage;
  return (
    <div className="mt-1 space-y-3 rounded-md border border-cm-border bg-cm-bg/50 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-cm-muted">Totals</div>
        <dl className="mt-1.5 grid grid-cols-2 gap-y-1 text-xs">
          <dt className="text-cm-muted">All time</dt><dd className="text-right tabular-nums">{totals.total}</dd>
          <dt className="text-cm-muted">Last 24h</dt><dd className="text-right tabular-nums">{totals.last24h}</dd>
          <dt className="text-cm-muted">Last 7d</dt><dd className="text-right tabular-nums">{totals.last7d}</dd>
          <dt className="text-cm-muted">7d 2xx</dt><dd className="text-right tabular-nums text-cm-success">{totals.lastStatusOk}</dd>
          <dt className="text-cm-muted">7d errors</dt><dd className="text-right tabular-nums text-cm-danger">{totals.lastStatusErr}</dd>
          <dt className="text-cm-muted">Unique IPs</dt><dd className="text-right tabular-nums">{uniqueIps}</dd>
          <dt className="text-cm-muted">First seen</dt><dd className="text-right text-[11px]">{totals.firstAt ? fmtRelative(totals.firstAt) : 'never'}</dd>
        </dl>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-cm-muted">Top routes</div>
        <ul className="mt-1.5 space-y-1">
          {byRoute.map((r) => (
            <li key={`${r.method} ${r.route}`} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate font-mono text-cm-muted">
                <span className="text-cm-fg">{r.method}</span> {r.route}
              </span>
              <span className="tabular-nums text-cm-muted">{r.count}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-cm-muted">Source IPs</div>
        {byIp.length === 0 ? (
          <div className="mt-1.5 text-xs text-cm-muted">No IPs captured yet.</div>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {byIp.map((r) => (
              <li key={r.ip} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-mono text-cm-fg" title={r.ip}>{r.ip}</span>
                <span className="shrink-0 tabular-nums text-cm-muted">{r.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-cm-muted">Recent calls</div>
        <ul className="mt-1.5 space-y-1">
          {recent.map((ev, i) => (
            <li key={i} className="flex flex-col gap-0.5 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-2">
              <span className="truncate font-mono text-cm-muted">
                <span className={ev.status >= 400 ? 'text-cm-danger' : 'text-cm-success'}>{ev.status}</span>{' '}
                {ev.method} {ev.route}
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[11px] text-cm-muted">
                {ev.ip ? (
                  <span
                    className="truncate font-mono text-cm-fg"
                    title={ev.ua ? `${ev.ip} \u00b7 ${ev.ua}` : ev.ip}
                  >
                    {ev.ip}
                  </span>
                ) : (
                  <span className="text-cm-muted">unknown</span>
                )}
                <span className="tabular-nums">{fmtRelative(ev.ts)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
