'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, ApiError } from '@/lib/api';
import {
  ErrorState,
  Spinner,
  IconArrowRight,
  IconCheck,
  IconCopy,
  IconKey,
  IconPlus,
  IconRefresh,
  IconShield,
  IconTrash,
  IconWarning,
} from '@clawmind/ui';

// Honeytoken (canary) API keys.
//
// A canary key is an API key that is never handed to a real caller. It is
// planted in a place an attacker is likely to find. The instant any
// process actually presents it on the wire, the server rejects the
// request with an identical-looking 401 (so the attacker sees nothing
// special) and records a forensic incident with source IP, route, time,
// and user agent. This page lets a workspace owner mint canaries, see
// which ones have fired, and inspect the trip log.

type Canary = {
  id: string;
  label: string;
  canaryNote: string | null;
  createdAt: number;
  revokedAt: number | null;
  tripCount: number;
};

type Incident = {
  id: string;
  keyId: string;
  keyLabel: string;
  note: string | null;
  ip: string | null;
  userAgent: string | null;
  route: string | null;
  method: string | null;
  requestId: string | null;
  tippedAt: number;
};

function fmtTime(ts: number): string {
  if (!ts) return 'never';
  try {
    return new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
  } catch {
    return 'unknown';
  }
}

function explainError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Sign in required.';
    if (err.status === 403) return 'Owner role required.';
    if (err.status === 412) return 'MFA step-up required. Verify a TOTP code and try again.';
    if (err.status === 423) return 'Workspace is frozen.';
    return err.message;
  }
  return (err as Error).message;
}

export default function HoneytokensPage() {
  const [canaries, setCanaries] = useState<Canary[] | null>(null);
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<{ id: string; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, inc] = await Promise.all([
        api.honeytokenList(),
        api.honeytokenIncidents({ limit: 200 }),
      ]);
      setCanaries(c.items);
      setIncidents(inc.items);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const out = await api.honeytokenIssue({
        label: label.trim(),
        note: note.trim() || null,
      });
      setRevealedSecret({ id: out.key.id, secret: out.secret });
      setLabel('');
      setNote('');
      await load();
    } catch (err) {
      setActionError(explainError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setActionError(null);
    try {
      await api.honeytokenRevoke(id);
      if (revealedSecret?.id === id) setRevealedSecret(null);
      await load();
    } catch (err) {
      setActionError(explainError(err));
    }
  };

  const handleClearIncidents = async () => {
    if (!incidents || incidents.length === 0) return;
    setActionError(null);
    try {
      await api.honeytokenIncidentsClear();
      await load();
    } catch (err) {
      setActionError(explainError(err));
    }
  };

  const copySecret = async () => {
    if (!revealedSecret) return;
    try {
      await navigator.clipboard.writeText(revealedSecret.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore; the secret is also visible in the textarea
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <Link
              href="/settings"
              className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <IconArrowRight className="h-3 w-3 rotate-180" />
              Settings
            </Link>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <IconShield className="h-6 w-6 text-amber-500" />
              Honeytokens
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Canary API keys that grant nothing and never appear in your real key
              list. Plant one anywhere an attacker is likely to look. The first
              request that presents the secret is rejected and recorded as a
              forensic incident with source IP, route, and timestamp.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
          >
            <IconRefresh className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>

        {actionError && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-600">
            <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}

        {revealedSecret && (
          <section className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-700">
              <IconKey className="h-4 w-4" />
              Plant this secret now. It will not be shown again.
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded border border-border bg-background px-3 py-2 font-mono text-xs">
                {revealedSecret.secret}
              </code>
              <button
                type="button"
                onClick={copySecret}
                className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted"
              >
                {copied ? <IconCheck className="h-3.5 w-3.5" /> : <IconCopy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Treat this string as bait. Do not use it for any real call.
            </p>
          </section>
        )}

        <section className="mb-8 rounded-lg border border-border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-base font-medium">
            <IconPlus className="h-4 w-4 text-muted-foreground" />
            Mint a canary
          </h2>
          <form onSubmit={handleIssue} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (e.g. legacy-mobile-build)"
              maxLength={80}
              required
              className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            />
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Where did you plant it? (optional)"
              maxLength={500}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            />
            <button
              type="submit"
              disabled={submitting || !label.trim()}
              className="inline-flex items-center justify-center gap-1 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {submitting ? <Spinner size={16} /> : <IconKey className="h-4 w-4" />}
              Mint canary
            </button>
          </form>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-base font-medium">Armed traps</h2>
          {loading && !canaries && (
            <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
              <Spinner size={20} />
              <div className="mt-2">Loading</div>
            </div>
          )}
          {error && <ErrorState message={error} onRetry={load} />}
          {!loading && canaries && canaries.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No canaries planted yet. Mint one above and embed the secret somewhere an attacker might find it.
            </div>
          )}
          {canaries && canaries.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Label</th>
                    <th className="px-4 py-2 font-medium">Note</th>
                    <th className="px-4 py-2 font-medium">Created</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">Trips</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {canaries.map((c) => (
                    <tr key={c.id} className="border-t border-border">
                      <td className="px-4 py-2 font-medium">{c.label}</td>
                      <td className="px-4 py-2 text-muted-foreground">{c.canaryNote ?? '—'}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{fmtTime(c.createdAt)}</td>
                      <td className="px-4 py-2">
                        {c.revokedAt ? (
                          <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">revoked</span>
                        ) : c.tripCount > 0 ? (
                          <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-600">tripped</span>
                        ) : (
                          <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600">armed</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{c.tripCount}</td>
                      <td className="px-4 py-2 text-right">
                        {!c.revokedAt && (
                          <button
                            type="button"
                            onClick={() => handleRevoke(c.id)}
                            aria-label={`Revoke canary ${c.label}`}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <IconTrash className="h-3.5 w-3.5" />
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-medium">Incident log</h2>
            {incidents && incidents.length > 0 && (
              <button
                type="button"
                onClick={handleClearIncidents}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
              >
                <IconTrash className="h-3.5 w-3.5" />
                Clear log
              </button>
            )}
          </div>
          {!loading && incidents && incidents.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No incidents recorded. If a canary fires, the trip will appear here with full forensic context.
            </div>
          )}
          {incidents && incidents.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Time</th>
                    <th className="px-4 py-2 font-medium">Trap</th>
                    <th className="px-4 py-2 font-medium">Source IP</th>
                    <th className="px-4 py-2 font-medium">Route</th>
                    <th className="px-4 py-2 font-medium">User agent</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((inc) => (
                    <tr key={inc.id} className="border-t border-border">
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{fmtTime(inc.tippedAt)}</td>
                      <td className="px-4 py-2 font-medium">{inc.keyLabel}</td>
                      <td className="px-4 py-2 font-mono text-xs">{inc.ip ?? '—'}</td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {inc.method ?? ''} {inc.route ?? '—'}
                      </td>
                      <td className="px-4 py-2 max-w-[20rem] truncate text-xs text-muted-foreground" title={inc.userAgent ?? ''}>
                        {inc.userAgent ?? '—'}
                      </td>
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
