'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, fmtRelative, type ShareSummary } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconLink,
  IconCopy,
  IconCheck,
  IconTrash,
} from '@clawmind/ui';

export default function SharesPage() {
  const [items, setItems] = useState<ShareSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.listShares());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function copyLink(item: ShareSummary) {
    const url = typeof window === 'undefined'
      ? item.url
      : `${window.location.origin}${item.url}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId((cur) => (cur === item.id ? null : cur)), 1500);
    } catch {
      /* ignore */
    }
  }

  async function revoke(item: ShareSummary) {
    if (!confirm(`Revoke this share? The link /s/${item.id} will stop working.`)) return;
    setRevokingId(item.id);
    try {
      await api.deleteShare(item.id);
      setItems((cur) => cur.filter((s) => s.id !== item.id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRevokingId(null);
    }
  }

  const totalViews = items.reduce((n, s) => n + s.views, 0);

  return (
    <main className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Public shares</h1>
            <p className="mt-1 text-sm text-cm-muted">
              Every answer you shared as a public link. Anyone with the URL can read it
              until you revoke it here.
            </p>
          </div>
          {!loading && !error && items.length > 0 && (
            <div className="text-xs text-cm-muted">
              {items.length} share{items.length === 1 ? '' : 's'}, {totalViews} view
              {totalViews === 1 ? '' : 's'}
            </div>
          )}
        </header>

        <section className="mt-6">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-cm-muted" role="status">
              <Spinner /> Loading shares
            </div>
          )}

          {!loading && error && (
            <ErrorState
              title="Could not load shares"
              message={error}
              onRetry={load}
            />
          )}

          {!loading && !error && items.length === 0 && (
            <div className="flex flex-col items-center gap-3">
              <EmptyState
                icon={<IconLink size={28} />}
                title="No public shares yet"
                body="When you share an answer from a chat, it shows up here so you can copy the link again or take it down."
              />
              <Link
                href="/chat"
                className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm hover:bg-cm-accent-soft"
              >
                Open Ask
              </Link>
            </div>
          )}

          {!loading && !error && items.length > 0 && (
            <ul className="flex flex-col gap-2">
              {items.map((item) => {
                const copied = copiedId === item.id;
                const revoking = revokingId === item.id;
                return (
                  <li
                    key={item.id}
                    className="rounded-lg border border-cm-border bg-cm-bg-soft p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/s/${item.id}`}
                          className="block truncate text-sm font-medium hover:underline"
                          title={item.query}
                        >
                          {item.query}
                        </Link>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-cm-muted">
                          <span>/s/{item.id}</span>
                          <span aria-hidden>·</span>
                          <span>{fmtRelative(item.createdAt)}</span>
                          <span aria-hidden>·</span>
                          <span>{item.views} view{item.views === 1 ? '' : 's'}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => copyLink(item)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2.5 py-1.5 text-xs hover:bg-cm-accent-soft"
                          aria-label="Copy share link"
                        >
                          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                          {copied ? 'Copied' : 'Copy link'}
                        </button>
                        <button
                          type="button"
                          onClick={() => revoke(item)}
                          disabled={revoking}
                          className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60 dark:hover:bg-red-950/30"
                          aria-label="Revoke share"
                        >
                          {revoking ? <Spinner /> : <IconTrash size={14} />}
                          {revoking ? 'Revoking' : 'Revoke'}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
