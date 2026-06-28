'use client';

// Tags surface: a workspace-wide directory of labels applied to source paths.
// This page is the list view; clicking a tag drills into /tags/[tag] which
// shows the paths carrying it. We deliberately keep mutations off this page
// because tag writes are per-path operations and live with the source viewer
// rather than in a list-of-labels UI.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, type TagSummary } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconTag,
  IconRefresh,
  IconSearch,
} from '@clawmind/ui';

export default function TagsPage() {
  const [items, setItems] = useState<TagSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.tagsList());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = needle ? items.filter((t) => t.tag.toLowerCase().includes(needle)) : items;
    // Rank by frequency (desc), then alpha for ties, so the labels carrying
    // the most material always sit at the top-left where the eye lands first.
    return [...base].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [items, q]);

  const totalRefs = useMemo(
    () => items.reduce((acc, t) => acc + t.count, 0),
    [items],
  );

  // Scale every usage bar to the single most-used tag so the busiest label is
  // full-width and the rest read proportionally against it. A daily user can
  // then tell a canonical, heavily-applied tag from a one-off at a glance,
  // which the bare count chip never communicated.
  const maxCount = useMemo(
    () => items.reduce((m, t) => Math.max(m, t.count), 0) || 1,
    [items],
  );

  return (
    <main className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Tags</h1>
            <p className="mt-1 text-sm text-cm-muted">
              Workspace labels applied to source paths. Tags act as retrieval filters and as a
              curation shortcut for finding related material.
            </p>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 self-start rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
          >
            <IconRefresh size={14} /> Refresh
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <IconSearch size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cm-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter tags"
              className="w-full rounded-md border border-cm-border bg-cm-bg py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-cm-accent"
            />
          </div>
          <div className="text-xs text-cm-muted">
            {items.length} tag{items.length === 1 ? '' : 's'} - {totalRefs} reference{totalRefs === 1 ? '' : 's'}
          </div>
        </div>

        {error && (
          <div className="mt-4">
            <ErrorState message={error} onRetry={load} />
          </div>
        )}

        <div className="mt-5">
          {loading && items.length === 0 ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : items.length === 0 ? (
            <EmptyState
              title="No tags yet"
              body="Open a source from the sources list and apply tags from its detail view to start grouping material."
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No matches"
              body={`No tag contains "${q.trim()}". Clear the filter to see all tags.`}
            />
          ) : (
            <ul className="cm-card grid grid-cols-1 gap-px overflow-hidden bg-cm-border sm:grid-cols-2">
              {filtered.map((t) => {
                const pct = Math.max(4, Math.round((t.count / maxCount) * 100));
                return (
                <li key={t.tag} className="bg-cm-bg">
                  <Link
                    href={{ pathname: `/tags/${encodeURIComponent(t.tag)}` }}
                    className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-cm-accent-soft"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <IconTag size={14} className="shrink-0 text-cm-accent" />
                        <span className="truncate font-mono text-sm" title={t.tag}>{t.tag}</span>
                      </div>
                      <span className="shrink-0 rounded-full border border-cm-border px-2 py-0.5 text-xs text-cm-muted">
                        {t.count}
                      </span>
                    </div>
                    {/* Proportional usage bar: width = this tag's reference
                        count as a share of the most-used tag. Turns the flat
                        grid into a frequency map so heavy, canonical labels
                        stand out from one-off tags at a glance. */}
                    <div
                      className="h-1 w-full overflow-hidden rounded-full bg-cm-subtle"
                      role="img"
                      aria-label={`${t.count} reference${t.count === 1 ? '' : 's'}`}
                    >
                      <div
                        className="h-full rounded-full bg-cm-accent transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </Link>
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
