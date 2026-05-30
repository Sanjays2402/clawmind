'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, fmtRelative, type DigestSummary, type SavedSearch } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconBook,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconArrowRight,
} from '@clawmind/ui';

interface Combined {
  saved: SavedSearch;
  digest?: DigestSummary;
}

export default function SavedPage() {
  const [rows, setRows] = useState<Combined[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<{ id: string; added: number; removed: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [saved, digests] = await Promise.all([
        api.savedList(),
        api.digests().catch(() => [] as DigestSummary[]),
      ]);
      const byId = new Map(digests.map((d) => [d.savedSearchId, d]));
      setRows(saved.map((s) => ({ saved: s, digest: byId.get(s.id) })));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !query.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      await api.saveSearch({ title: title.trim(), query: query.trim() });
      setTitle('');
      setQuery('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Remove this saved search?')) return;
    try {
      await api.removeSaved(id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function runDigest(id: string) {
    setRunningId(id);
    setLastRun(null);
    setError(null);
    try {
      const res = await api.digestRun(id);
      setLastRun({ id, added: res.entry.newSources.length, removed: res.entry.removedSources.length });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunningId(null);
    }
  }

  return (
    <main className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Saved searches</h1>
            <p className="mt-1 text-sm text-cm-muted">
              Reusable queries. Run a digest to see what is new since the last time you checked.
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
            <IconPlus size={16} /> Save a new search
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className="rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cm-accent"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Query, e.g. recent commits about ingest"
              className="rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cm-accent"
            />
            <button
              type="submit"
              disabled={creating || !title.trim() || !query.trim()}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-cm-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {creating ? <Spinner size={14} /> : <IconPlus size={14} />}
              Save
            </button>
          </div>
        </form>

        {error && <div className="mt-4"><ErrorState message={error} onRetry={() => setError(null)} retryLabel="Dismiss" /></div>}
        {lastRun && (
          <div className="mt-3 cm-card flex items-center justify-between p-3 text-sm">
            <span>
              Digest run: <span className="text-cm-success">+{lastRun.added}</span>{' '}
              <span className="text-cm-danger">-{lastRun.removed}</span> sources
            </span>
            <button onClick={() => setLastRun(null)} className="text-xs text-cm-muted hover:text-cm-fg">dismiss</button>
          </div>
        )}

        <div className="mt-5">
          {loading && rows.length === 0 ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : rows.length === 0 ? (
            <EmptyState
              title="No saved searches"
              body="Save your first query above. Then run a digest to track what changes."
            />
          ) : (
            <ul className="cm-card divide-y divide-cm-border">
              {rows.map(({ saved, digest }) => (
                <li key={saved.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <IconBook size={14} className="text-cm-muted" />
                      <span className="truncate text-sm font-medium">{saved.title}</span>
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-cm-muted">{saved.query}</div>
                    {digest && (
                      <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-cm-muted">
                        <span>last run {fmtRelative(digest.lastRunTs)}</span>
                        <span>{digest.runs} runs</span>
                        {digest.lastNewCount > 0 && (
                          <span className="text-cm-success">+{digest.lastNewCount} new</span>
                        )}
                        {digest.lastRemovedCount > 0 && (
                          <span className="text-cm-danger">-{digest.lastRemovedCount} removed</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Link
                      href={`/saved/${saved.id}/snapshots`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
                    >
                      Snapshots
                    </Link>
                    <button
                      onClick={() => runDigest(saved.id)}
                      disabled={runningId === saved.id}
                      className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm hover:text-cm-fg disabled:opacity-50"
                    >
                      {runningId === saved.id ? <Spinner size={14} /> : <IconArrowRight size={14} />}
                      Run digest
                    </button>
                    <button
                      onClick={() => remove(saved.id)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2 py-1.5 text-sm text-cm-muted hover:text-cm-danger"
                      title="Delete"
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
