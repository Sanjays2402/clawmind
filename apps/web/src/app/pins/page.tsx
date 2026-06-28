'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, fmtRelative, type PinEntry } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconPushPin,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconArrowRight,
} from '@clawmind/ui';

export default function PinsPage() {
  const [items, setItems] = useState<PinEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState('');
  const [note, setNote] = useState('');
  const [creating, setCreating] = useState(false);
  const [removingPath, setRemovingPath] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.pinsList());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!path.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      await api.pinAdd(path.trim(), note.trim() || undefined);
      setPath('');
      setNote('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function remove(p: string) {
    if (!confirm(`Unpin ${p}?`)) return;
    setRemovingPath(p);
    try {
      await api.pinRemove(p);
      setItems((cur) => cur.filter((it) => it.path !== p));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRemovingPath(null);
    }
  }

  // Recency bounds across the current pin set. The per-row recency rail scales
  // each pin between the oldest and freshest pinnedAt, so the lane reads as a
  // gradient: the most recently pinned source glows brightest, older ones fade.
  const { minPinned, maxPinned } = useMemo(() => {
    if (items.length === 0) return { minPinned: 0, maxPinned: 0 };
    let lo = Infinity;
    let hi = -Infinity;
    for (const it of items) {
      if (it.pinnedAt < lo) lo = it.pinnedAt;
      if (it.pinnedAt > hi) hi = it.pinnedAt;
    }
    return { minPinned: lo, maxPinned: hi };
  }, [items]);

  return (
    <main className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Pinned sources</h1>
            <p className="mt-1 text-sm text-cm-muted">
              Pinned paths get a retrieval boost. Use them for canonical references the assistant should lean on.
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
            <IconPlus size={16} /> Pin a source
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[2fr_2fr_auto]">
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="Path, e.g. docs/architecture.md"
              className="rounded-md border border-cm-border bg-cm-bg px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-cm-accent"
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note"
              maxLength={500}
              className="rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cm-accent"
            />
            <button
              type="submit"
              disabled={creating || !path.trim()}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-cm-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {creating ? <Spinner size={14} /> : <IconPushPin size={14} />}
              Pin
            </button>
          </div>
          <p className="mt-2 text-xs text-cm-muted">
            Tip: copy a path from the <Link href="/sources" className="underline">sources list</Link>.
          </p>
        </form>

        {error && (
          <div className="mt-4">
            <ErrorState message={error} onRetry={() => setError(null)} retryLabel="Dismiss" />
          </div>
        )}

        <div className="mt-5">
          {loading && items.length === 0 ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : items.length === 0 ? (
            <EmptyState
              title="No pins yet"
              body="Pin a source above to give it a retrieval boost across search and chat."
            />
          ) : (
            <ul className="cm-card divide-y divide-cm-border">
              {items.map((p) => {
                const isNewest = p.pinnedAt === maxPinned && items.length > 1;
                return (
                <li key={p.path} className="flex items-stretch gap-3 p-4">
                  <RecencyRail pinnedAt={p.pinnedAt} min={minPinned} max={maxPinned} newest={isNewest} />
                  <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <IconPushPin size={14} className="text-cm-accent" />
                      <Link
                        href={{ pathname: '/sources/view', query: { path: p.path } }}
                        className="truncate font-mono text-sm hover:underline"
                        title={p.path}
                      >
                        {p.path}
                      </Link>
                      {isNewest && (
                        <span className="cm-mono rounded-full bg-cm-accent-soft px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-cm-accent">
                          newest
                        </span>
                      )}
                    </div>
                    {p.note && (
                      <div className="mt-1 truncate text-sm text-cm-muted" title={p.note}>{p.note}</div>
                    )}
                    <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-cm-muted">
                      <span>pinned {fmtRelative(p.pinnedAt)}</span>
                      <span>by {p.pinnedBy}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Link
                      href={{ pathname: '/sources/view', query: { path: p.path } }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm hover:text-cm-fg"
                    >
                      <IconArrowRight size={14} /> Open
                    </Link>
                    <button
                      onClick={() => remove(p.path)}
                      disabled={removingPath === p.path}
                      className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2 py-1.5 text-sm text-cm-muted hover:text-cm-danger disabled:opacity-50"
                      title="Unpin"
                    >
                      {removingPath === p.path ? <Spinner size={14} /> : <IconTrash size={14} />}
                    </button>
                  </div>
                  </div>
                </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}

/**
 * Per-row recency lane. Pinned-at used to be plain text, so a long pin list
 * gave no sense of which references are fresh vs stale at a glance. This adds a
 * thin vertical rail down the left of each row whose fill maps the pin's age
 * within the set: the freshest pin fills the whole rail in the solid accent,
 * the oldest barely a sliver, everything else proportionally between (older
 * pins use the softer accent line so the freshest stays the brightest mark).
 */
function RecencyRail({
  pinnedAt,
  min,
  max,
  newest,
}: {
  pinnedAt: number;
  min: number;
  max: number;
  newest: boolean;
}) {
  // Normalise age to [0,1]; a single-pin set (min === max) reads as full.
  const span = max - min;
  const frac = span > 0 ? (pinnedAt - min) / span : 1;
  // Floor at 12% so even the oldest pin shows a visible mark, not an empty rail.
  const fillPct = Math.max(0.12, frac) * 100;
  return (
    <span
      aria-hidden="true"
      className="relative w-1 shrink-0 self-stretch overflow-hidden rounded-full"
      style={{ background: 'var(--cm-subtle)', minHeight: 36 }}
      title={newest ? 'Freshest pin in this list' : undefined}
    >
      <span
        className="absolute inset-x-0 bottom-0 rounded-full"
        style={{
          height: `${fillPct}%`,
          background: newest ? 'var(--cm-accent)' : 'var(--cm-accent-line)',
        }}
      />
    </span>
  );
}

