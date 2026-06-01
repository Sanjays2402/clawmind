'use client';
// Per-key scheduled activation. Owner-only on the server; non-owners
// will see a 403 from the API call and the page renders an error.
//
// Enterprise customers cut over credentials on a fixed calendar: a new
// CI key for a vendor must start working at 09:00 UTC on Monday and not
// a minute earlier. Letting them pre-mint the key and pin its activation
// timestamp removes a manual "rotate at exactly the right moment" step
// from their change-management runbook, and removes the temptation to
// share the secret early "just in case".

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, ApiError, type ApiKey } from '@/lib/api';
import {
  Spinner,
  IconKey,
  IconClockCountdown,
  IconCheck,
  IconWarning,
  IconArrowRight,
} from '@clawmind/ui';

function fmtAbsolute(ms: number): string {
  return new Date(ms).toLocaleString();
}

function fmtRelative(ms: number, now: number): string {
  const delta = Math.max(0, ms - now);
  const sec = Math.round(delta / 1000);
  if (sec < 60) return `in ${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `in ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `in ${hr} h`;
  const day = Math.round(hr / 24);
  return `in ${day} days`;
}

function toLocalInputValue(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(v: string): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

interface RowState {
  draft: string;
  busy: boolean;
  error: string | null;
}

export default function KeyActivationPage() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      setLoadErr(null);
      const items = await api.keysList();
      setKeys(items);
      setRows((prev) => {
        const next: Record<string, RowState> = {};
        for (const k of items) {
          next[k.id] = prev[k.id] ?? {
            draft: toLocalInputValue(k.notBefore ?? null),
            busy: false,
            error: null,
          };
        }
        return next;
      });
    } catch (err) {
      setLoadErr(err instanceof ApiError ? err.message : 'Failed to load keys.');
      setKeys([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Live tick so "in 12 min" labels stay honest without a page reload.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  const now = useMemo(() => Date.now() + (tick - tick), [tick]);

  const setDraft = (id: string, draft: string) =>
    setRows((r) => ({ ...r, [id]: { ...(r[id] ?? { busy: false, error: null, draft: '' }), draft, error: null } }));

  const save = async (k: ApiKey) => {
    const row = rows[k.id];
    if (!row) return;
    const ts = fromLocalInputValue(row.draft);
    if (row.draft && ts === null) {
      setRows((r) => ({ ...r, [k.id]: { ...row, error: 'Invalid date and time.' } }));
      return;
    }
    setRows((r) => ({ ...r, [k.id]: { ...row, busy: true, error: null } }));
    try {
      const updated = await api.keySetActivation(k.id, ts);
      setKeys((cur) => (cur ?? []).map((x) => (x.id === k.id ? updated : x)));
      setRows((r) => ({
        ...r,
        [k.id]: { draft: toLocalInputValue(updated.notBefore ?? null), busy: false, error: null },
      }));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to save activation.';
      setRows((r) => ({ ...r, [k.id]: { ...row, busy: false, error: msg } }));
    }
  };

  const clear = async (k: ApiKey) => {
    const row = rows[k.id] ?? { draft: '', busy: false, error: null };
    setRows((r) => ({ ...r, [k.id]: { ...row, busy: true, error: null } }));
    try {
      const updated = await api.keySetActivation(k.id, null);
      setKeys((cur) => (cur ?? []).map((x) => (x.id === k.id ? updated : x)));
      setRows((r) => ({ ...r, [k.id]: { draft: '', busy: false, error: null } }));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to clear activation.';
      setRows((r) => ({ ...r, [k.id]: { ...row, busy: false, error: msg } }));
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-start gap-3">
          <div className="rounded-lg border border-border bg-surface p-2 text-primary">
            <IconClockCountdown size={22} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Key activation schedule</h1>
            <p className="mt-1 text-sm text-muted">
              Pre-mint API keys for a planned cutover. A key with a future activation
              timestamp authenticates with <code className="rounded bg-surface px-1">401 not_yet_active</code>{' '}
              until the moment arrives, then becomes live without a separate rotation step.
            </p>
            <p className="mt-2 text-sm">
              <Link href="/settings" className="text-primary underline-offset-2 hover:underline">
                Back to settings
              </Link>
            </p>
          </div>
        </div>

        {loadErr ? (
          <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
            <IconWarning size={18} />
            <span>{loadErr}</span>
          </div>
        ) : null}

        {keys === null ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Loading keys...
          </div>
        ) : keys.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted">
            <IconKey size={28} className="mx-auto mb-2 text-muted" />
            <p>No API keys yet.</p>
            <Link
              href="/settings/api-key-policy"
              className="mt-2 inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
            >
              Issue one in API keys <IconArrowRight size={14} />
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {keys.map((k) => {
              const row = rows[k.id] ?? { draft: '', busy: false, error: null };
              const scheduled = k.notBefore && k.notBefore > now;
              const cleared = !k.notBefore;
              return (
                <li
                  key={k.id}
                  className="rounded-lg border border-border bg-surface p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <IconKey size={16} className="text-muted" />
                        <span className="truncate font-medium">{k.label}</span>
                        {k.revokedAt ? (
                          <span className="rounded-full bg-muted/20 px-2 py-0.5 text-xs text-muted">
                            revoked
                          </span>
                        ) : scheduled ? (
                          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning">
                            pending
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">
                            <IconCheck size={12} /> active
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        Issued {fmtAbsolute(k.createdAt)}
                        {k.expiresAt ? ` , expires ${fmtAbsolute(k.expiresAt)}` : ''}
                      </p>
                      {scheduled ? (
                        <p className="mt-1 text-xs text-warning">
                          Activates {fmtAbsolute(k.notBefore!)} ({fmtRelative(k.notBefore!, now)})
                        </p>
                      ) : cleared ? (
                        <p className="mt-1 text-xs text-muted">No scheduled activation.</p>
                      ) : (
                        <p className="mt-1 text-xs text-muted">
                          Activated {fmtAbsolute(k.notBefore!)}
                        </p>
                      )}
                    </div>
                  </div>

                  <fieldset
                    disabled={Boolean(k.revokedAt) || row.busy}
                    className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]"
                  >
                    <label className="text-sm">
                      <span className="sr-only">Activation timestamp for {k.label}</span>
                      <input
                        type="datetime-local"
                        value={row.draft}
                        onChange={(e) => setDraft(k.id, e.target.value)}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        aria-label={`Activation timestamp for ${k.label}`}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void save(k)}
                      className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      {row.busy ? <Spinner /> : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void clear(k)}
                      className="rounded-md border border-border px-3 py-2 text-sm hover:bg-surface disabled:opacity-50"
                    >
                      Clear
                    </button>
                  </fieldset>

                  {row.error ? (
                    <div className="mt-2 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
                      <IconWarning size={14} />
                      <span>{row.error}</span>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <section className="mt-8 rounded-lg border border-border bg-surface p-4 text-sm text-muted">
          <h2 className="mb-2 text-sm font-semibold text-foreground">How it behaves</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Maximum schedule window is 365 days into the future.</li>
            <li>The key returns <code className="rounded bg-background px-1">401</code> with reason <code className="rounded bg-background px-1">not_yet_active</code> and a <code className="rounded bg-background px-1">Retry-After</code> header until the moment arrives.</li>
            <li>If the key has a TTL, the activation must land strictly before its expiry.</li>
            <li>Every scheduling change is recorded in the audit log.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
