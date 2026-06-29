'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TopNav } from '@/components/TopNav';
import { api, fmtRelative, type NotificationItem, type NotificationKind } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconBell,
  IconCheck,
  IconTrash,
  IconLink,
  IconWebhook,
  IconSpark,
  IconArrowRight,
} from '@clawmind/ui';

function kindIcon(kind: NotificationKind) {
  switch (kind) {
    case 'share.viewed': return IconLink;
    case 'webhook.disabled':
    case 'webhook.failed': return IconWebhook;
    default: return IconSpark;
  }
}

function kindLabel(kind: NotificationKind): string {
  switch (kind) {
    case 'share.viewed': return 'Share';
    case 'webhook.disabled': return 'Webhook';
    case 'webhook.failed': return 'Webhook';
    default: return 'System';
  }
}

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listNotifications({ limit: 100, unread: filter === 'unread' });
      setItems(res.items);
      setUnread(res.unread);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function markOneRead(item: NotificationItem) {
    if (item.readAt) return;
    setBusy(item.id);
    try {
      await api.markNotificationsRead({ ids: [item.id] });
      setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, readAt: Date.now() } : i)));
      setUnread((n) => Math.max(0, n - 1));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function markAll() {
    setBusy('all');
    try {
      await api.markNotificationsRead({ all: true });
      const now = Date.now();
      setItems((cur) => cur.map((i) => (i.readAt ? i : { ...i, readAt: now })));
      setUnread(0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function removeOne(item: NotificationItem) {
    setBusy(item.id);
    try {
      await api.deleteNotification(item.id);
      setItems((cur) => cur.filter((i) => i.id !== item.id));
      if (!item.readAt) setUnread((n) => Math.max(0, n - 1));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function clearAll() {
    if (!confirm('Clear every notification? This cannot be undone.')) return;
    setBusy('all');
    try {
      await api.clearNotifications();
      setItems([]);
      setUnread(0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // Keyboard rove over the inbox rows. The j/k rail moves a focus ring like
  // /search and /sources, but notifications carry per-row actions so the ring
  // doubles as a command target: Enter opens the row's link (and marks it
  // read), e marks the focused row read, x removes it. Reset to the top when
  // the filter reloads the list so the ring never points at a stale row, and
  // skip events from the header controls so the filter/clear buttons keep
  // their own keys.
  const [activeRow, setActiveRow] = useState(0);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  useEffect(() => { setActiveRow(0); }, [filter, items.length]);
  function focusRow(i: number) {
    const n = Math.max(0, Math.min(items.length - 1, i));
    rowRefs.current[n]?.focus();
    setActiveRow(n);
  }
  function onRowsKey(e: React.KeyboardEvent) {
    if (items.length === 0) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const item = items[activeRow];
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      focusRow(activeRow + 1);
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      focusRow(activeRow - 1);
    } else if (e.key === 'Enter' && item) {
      if (!item.href) return;
      e.preventDefault();
      void markOneRead(item);
      router.push(item.href as string);
    } else if ((e.key === 'e' || e.key === 'E') && item) {
      e.preventDefault();
      void markOneRead(item);
    } else if ((e.key === 'x' || e.key === 'X') && item) {
      e.preventDefault();
      void removeOne(item);
      // The removed row drops out; keep the ring on the same index, which now
      // holds the next row down (clamped by focusRow on the next keypress).
      setActiveRow((i) => Math.max(0, Math.min(items.length - 2, i)));
    }
  }

  return (
    <main className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <IconBell size={22} />
              Notifications
            </h1>
            <p className="mt-1 text-sm text-cm-muted">
              Activity on your shares and webhooks. Quiet by design, never email.{' '}
              <Link href="/settings/notifications" className="underline hover:text-cm-fg">
                Preferences
              </Link>
              .
            </p>
            {items.length > 0 && (
              <p className="mt-1.5 hidden items-center gap-1.5 text-[11px] text-cm-muted sm:flex">
                <kbd className="rounded border border-cm-border bg-cm-bg px-1 font-mono">j</kbd>
                <kbd className="rounded border border-cm-border bg-cm-bg px-1 font-mono">k</kbd>
                move
                <kbd className="ml-1.5 rounded border border-cm-border bg-cm-bg px-1 font-mono">enter</kbd>
                open
                <kbd className="ml-1.5 rounded border border-cm-border bg-cm-bg px-1 font-mono">e</kbd>
                read
                <kbd className="ml-1.5 rounded border border-cm-border bg-cm-bg px-1 font-mono">x</kbd>
                remove
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className="inline-flex overflow-hidden rounded-md border border-cm-border">
              <button
                type="button"
                onClick={() => setFilter('all')}
                className={[
                  'px-2.5 py-1 transition-colors',
                  filter === 'all' ? 'bg-cm-accent-soft text-cm-fg' : 'text-cm-muted hover:text-cm-fg',
                ].join(' ')}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setFilter('unread')}
                className={[
                  'border-l border-cm-border px-2.5 py-1 transition-colors',
                  filter === 'unread' ? 'bg-cm-accent-soft text-cm-fg' : 'text-cm-muted hover:text-cm-fg',
                ].join(' ')}
              >
                Unread {unread > 0 && (
                  <span className="ml-1 rounded-full bg-cm-accent px-1.5 py-px text-[10px] font-medium text-white">
                    {unread}
                  </span>
                )}
              </button>
            </div>
            <button
              type="button"
              onClick={markAll}
              disabled={unread === 0 || busy === 'all'}
              className="rounded-md border border-cm-border px-2.5 py-1 text-cm-muted hover:text-cm-fg disabled:opacity-40"
            >
              <span className="inline-flex items-center gap-1"><IconCheck size={12} /> Mark all read</span>
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={items.length === 0 || busy === 'all'}
              className="rounded-md border border-cm-border px-2.5 py-1 text-cm-muted hover:text-cm-fg disabled:opacity-40"
            >
              <span className="inline-flex items-center gap-1"><IconTrash size={12} /> Clear</span>
            </button>
          </div>
        </header>

        <section className="mt-6">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-cm-muted">
              <Spinner /> Loading notifications
            </div>
          )}
          {error && !loading && (
            <ErrorState
              title="Could not load notifications"
              message={error}
              onRetry={load}
            />
          )}
          {!loading && !error && items.length === 0 && (
            <EmptyState
              icon={<IconBell size={28} />}
              title={filter === 'unread' ? 'No unread notifications' : 'Inbox zero'}
              body={filter === 'unread'
                ? "You're caught up. Switch to All to see history."
                : 'When someone opens a share you minted or a webhook starts failing, it will show up here.'}
            />
          )}
          {!loading && !error && items.length > 0 && (
            <ul
              className="divide-y divide-cm-border rounded-lg border border-cm-border"
              onKeyDown={onRowsKey}
              aria-label="Notifications. Use j and k to move, Enter to open, e to mark read, x to remove."
            >
              {items.map((item, i) => {
                const Icon = kindIcon(item.kind);
                const isUnread = item.readAt === null;
                return (
                  <li
                    key={item.id}
                    ref={(el) => { rowRefs.current[i] = el; }}
                    tabIndex={i === activeRow ? 0 : -1}
                    onFocus={() => setActiveRow(i)}
                    aria-current={i === activeRow ? 'true' : undefined}
                    className={[
                      'flex items-start gap-3 px-4 py-3 outline-none transition-colors',
                      'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cm-accent',
                      isUnread ? 'bg-cm-accent-soft/40' : '',
                    ].join(' ')}
                  >
                    <div className="mt-0.5 text-cm-muted">
                      <Icon size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="truncate text-sm font-medium text-cm-fg">
                          {item.title}
                        </span>
                        <span className="text-[10.5px] uppercase tracking-wide text-cm-muted">
                          {kindLabel(item.kind)}
                        </span>
                        <span className="text-[11px] text-cm-muted">
                          {fmtRelative(item.createdAt)}
                        </span>
                        {isUnread && (
                          <span
                            aria-label="unread"
                            className="ml-auto inline-block h-1.5 w-1.5 rounded-full bg-cm-accent"
                          />
                        )}
                      </div>
                      {item.body && (
                        <p className="mt-0.5 truncate text-[13px] text-cm-muted">
                          {item.body}
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        {item.href && (
                          <Link
                            href={item.href as never}
                            onClick={() => markOneRead(item)}
                            className="inline-flex items-center gap-1 text-cm-muted hover:text-cm-fg"
                          >
                            Open <IconArrowRight size={12} />
                          </Link>
                        )}
                        {isUnread && (
                          <button
                            type="button"
                            onClick={() => markOneRead(item)}
                            disabled={busy === item.id}
                            className="inline-flex items-center gap-1 text-cm-muted hover:text-cm-fg disabled:opacity-40"
                          >
                            <IconCheck size={12} /> Mark read
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeOne(item)}
                          disabled={busy === item.id}
                          className="inline-flex items-center gap-1 text-cm-muted hover:text-cm-fg disabled:opacity-40"
                        >
                          <IconTrash size={12} /> Remove
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

      {unread > 0 && (
        <div className="sticky bottom-0 z-20 border-t border-cm-border bg-cm-bg/85 backdrop-blur">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
            <span className="inline-flex items-center gap-2 text-sm text-cm-muted">
              <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-cm-accent" aria-hidden="true" />
              {unread} unread notification{unread === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={markAll}
              disabled={busy === 'all'}
              className="inline-flex items-center gap-1.5 rounded-md bg-cm-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy === 'all' ? <Spinner size={14} /> : <IconCheck size={14} />}
              Mark all read
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
