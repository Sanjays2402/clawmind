'use client';
// Owner-only compliance review for the tamper-evident audit log.
//
// The log itself is a hash-chained JSONL file written by every mutation
// route. This page surfaces it to a human reviewer: filter by actor,
// action substring, resource prefix and time window, page through the
// matches newest first, and verify the on-disk hash chain on demand.
//
// All writes here are reads server-side; the only side effect a reviewer
// triggers is one extra `audit.query` (or `audit.verify`) entry, which is
// by design so the act of looking at the log leaves its own trace.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { TopNav } from '@/components/TopNav';
import { api, ApiError, fmtRelative, type AuditEvent, API_BASE } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconRefresh,
  IconWarning,
  IconCheck,
  IconKey,
} from '@clawmind/ui';

const PAGE_SIZE = 50;

interface Filters {
  actor: string;
  action: string;
  resource: string;
  since: string;
  until: string;
}

const EMPTY_FILTERS: Filters = { actor: '', action: '', resource: '', since: '', until: '' };

interface VerifyState {
  loading: boolean;
  result: Awaited<ReturnType<typeof api.auditVerify>> | null;
  error: string | null;
}

function toEpoch(localDateTime: string): number | undefined {
  if (!localDateTime) return undefined;
  const t = Date.parse(localDateTime);
  return Number.isFinite(t) ? t : undefined;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').replace(/\..*$/, '') + ' UTC';
}

function shortHash(h: string | undefined | null): string {
  if (!h) return '';
  return h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}

export default function AuditPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyState>({ loading: false, result: null, error: null });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const res = await api.auditQuery({
        actor: filters.actor || undefined,
        action: filters.action || undefined,
        resource: filters.resource || undefined,
        since: toEpoch(filters.since),
        until: toEpoch(filters.until),
        limit: PAGE_SIZE,
        offset,
      });
      setEvents(res.events);
      setTotal(res.total);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setForbidden(true);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }, [filters, offset]);

  useEffect(() => { void load(); }, [load]);

  function apply(e: React.FormEvent) {
    e.preventDefault();
    setOffset(0);
    setFilters(draft);
  }

  function clearFilters() {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setOffset(0);
  }

  // Build the download URL with the currently APPLIED filters (not the
  // draft) and navigate the browser to it. The server streams an
  // attachment, so the page itself does not navigate; the download bar
  // appears instead. Auth cookies ride along automatically.
  function downloadExport(format: 'jsonl' | 'csv') {
    const q = new URLSearchParams();
    if (filters.actor) q.set('actor', filters.actor);
    if (filters.action) q.set('action', filters.action);
    if (filters.resource) q.set('resource', filters.resource);
    const since = toEpoch(filters.since);
    const until = toEpoch(filters.until);
    if (since !== undefined) q.set('since', String(since));
    if (until !== undefined) q.set('until', String(until));
    q.set('format', format);
    const url = `${API_BASE}/v1/admin/audit/export?${q.toString()}`;
    // Use an anchor click rather than window.location so the page itself
    // does not navigate; the browser handles the content-disposition.
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function runVerify() {
    setVerify({ loading: true, result: null, error: null });
    try {
      const result = await api.auditVerify();
      setVerify({ loading: false, result, error: null });
    } catch (err) {
      const msg = err instanceof ApiError && (err.status === 401 || err.status === 403)
        ? 'You do not have the audit:read scope on this session.'
        : (err as Error).message;
      setVerify({ loading: false, result: null, error: msg });
    }
  }

  const activeFilterCount = useMemo(
    () => Object.values(filters).filter((v) => v.trim().length > 0).length,
    [filters],
  );
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + events.length, total);
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <main className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
            <p className="mt-1 text-sm text-cm-muted">
              Tamper-evident record of every mutation on this workspace.
              Owner role and the audit:read scope are required.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadExport('jsonl')}
              disabled={forbidden}
              className="inline-flex items-center gap-1.5 self-start rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg disabled:opacity-50"
              title="Stream the full filtered chain as newline-delimited JSON."
            >
              <IconRefresh size={14} /> Export JSONL
            </button>
            <button
              onClick={() => downloadExport('csv')}
              disabled={forbidden}
              className="inline-flex items-center gap-1.5 self-start rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg disabled:opacity-50"
              title="Stream the full filtered chain as CSV for spreadsheet review."
            >
              <IconRefresh size={14} /> Export CSV
            </button>
            <button
              onClick={runVerify}
              disabled={verify.loading || forbidden}
              className="inline-flex items-center gap-1.5 self-start rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg disabled:opacity-50"
            >
              <IconKey size={14} /> {verify.loading ? 'Verifying' : 'Verify chain'}
            </button>
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1.5 self-start rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg disabled:opacity-50"
            >
              <IconRefresh size={14} /> Refresh
            </button>
          </div>
        </div>

        {verify.result ? (
          <div
            className={`mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
              verify.result.ok
                ? 'border-emerald-300/40 bg-emerald-500/10 text-emerald-700'
                : 'border-amber-400/40 bg-amber-500/10 text-amber-800'
            }`}
            role="status"
          >
            {verify.result.ok ? <IconCheck size={16} /> : <IconWarning size={16} />}
            <div>
              {verify.result.ok ? (
                <>
                  Chain intact across {verify.result.checked} records. Head hash{' '}
                  <code className="font-mono text-xs">{shortHash(verify.result.headHash)}</code>.
                </>
              ) : (
                <>
                  Chain broken after {verify.result.checked} records.
                  {verify.result.reason ? ` Reason: ${verify.result.reason}.` : ''}
                  {verify.result.brokenAt ? ` At ${verify.result.brokenAt.file}:${verify.result.brokenAt.line}.` : ''}
                </>
              )}
            </div>
          </div>
        ) : null}
        {verify.error ? (
          <div className="mt-4 rounded-md border border-rose-300/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">
            {verify.error}
          </div>
        ) : null}

        <form onSubmit={apply} className="mt-6 cm-card p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field
              label="Actor"
              placeholder="user id, exact"
              value={draft.actor}
              onChange={(v) => setDraft({ ...draft, actor: v })}
            />
            <Field
              label="Action"
              placeholder="substring, e.g. keys"
              value={draft.action}
              onChange={(v) => setDraft({ ...draft, action: v })}
            />
            <Field
              label="Resource"
              placeholder="prefix, e.g. /v1/keys"
              value={draft.resource}
              onChange={(v) => setDraft({ ...draft, resource: v })}
            />
            <Field
              label="Since"
              type="datetime-local"
              value={draft.since}
              onChange={(v) => setDraft({ ...draft, since: v })}
            />
            <Field
              label="Until"
              type="datetime-local"
              value={draft.until}
              onChange={(v) => setDraft({ ...draft, until: v })}
            />
          </div>
          <div className="mt-3 flex items-center justify-between">
            <div className="text-xs text-cm-muted">
              {activeFilterCount === 0
                ? 'Showing every recorded event, newest first.'
                : `${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} active.`}
            </div>
            <div className="flex gap-2">
              {activeFilterCount > 0 ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
                >
                  Clear
                </button>
              ) : null}
              <button
                type="submit"
                className="rounded-md bg-cm-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                Apply
              </button>
            </div>
          </div>
        </form>

        {forbidden ? (
          <div className="mt-8">
            <EmptyState
              title="Audit log is owner-only"
              body="Sign in as the workspace owner with the audit:read scope to review the chain."
            />
          </div>
        ) : loading && events.length === 0 ? (
          <div className="mt-12 flex justify-center"><Spinner /></div>
        ) : error ? (
          <div className="mt-8"><ErrorState message={error} onRetry={load} /></div>
        ) : events.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              title="No matching events"
              body={
                activeFilterCount > 0
                  ? 'Nothing matched these filters. Widen the window or clear them.'
                  : 'The audit log is empty. Mutations will appear here as they happen.'
              }
            />
          </div>
        ) : (
          <>
            <div className="mt-6 cm-card overflow-hidden">
              <div className="flex items-center justify-between border-b border-cm-border px-4 py-3 text-xs text-cm-muted">
                <div>Showing {pageStart} to {pageEnd} of {total}</div>
                <div className="font-mono">page {Math.floor(offset / PAGE_SIZE) + 1}</div>
              </div>
              <ul className="divide-y divide-cm-border">
                {events.map((ev) => {
                  const isOpen = expanded === ev.id;
                  return (
                    <li key={ev.id} className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : ev.id)}
                        aria-expanded={isOpen}
                        className="grid w-full grid-cols-1 items-start gap-2 text-left sm:grid-cols-[160px_1fr_140px]"
                      >
                        <div className="text-xs text-cm-muted">
                          <div className="font-mono">{formatTimestamp(ev.ts)}</div>
                          <div className="mt-0.5">{fmtRelative(ev.ts)}</div>
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-cm-accent-soft px-1.5 py-0.5 font-mono text-[11px] text-cm-fg">
                              {ev.action}
                            </span>
                            <span className="text-sm">by</span>
                            <span className="font-mono text-sm">{ev.actor}</span>
                          </div>
                          <div className="mt-1 break-all font-mono text-xs text-cm-muted">
                            {ev.resource}
                          </div>
                        </div>
                        <div className="text-right font-mono text-[11px] text-cm-muted">
                          <div>id {shortHash(ev.id)}</div>
                          <div>hash {shortHash(ev.hash)}</div>
                        </div>
                      </button>
                      {isOpen ? (
                        <pre className="mt-3 max-h-72 overflow-auto rounded-md bg-cm-bg p-3 font-mono text-[11px] text-cm-fg">
{JSON.stringify(ev, null, 2)}
                        </pre>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-center justify-between border-t border-cm-border px-4 py-3">
                <button
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  disabled={!hasPrev || loading}
                  className="rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg disabled:opacity-40"
                >
                  Previous
                </button>
                <div className="text-xs text-cm-muted">
                  {loading ? 'Loading' : `${pageEnd} of ${total}`}
                </div>
                <button
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  disabled={!hasNext || loading}
                  className="rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'datetime-local';
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-cm-muted">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-md border border-cm-border bg-cm-bg px-2.5 py-1.5 text-sm text-cm-fg placeholder:text-cm-muted/60 focus:border-cm-accent focus:outline-none"
      />
    </label>
  );
}
