'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  IconPencil,
  IconCheck,
  IconTag,
} from '@clawmind/ui';

interface Combined {
  saved: SavedSearch;
  digest?: DigestSummary;
}

function normalizeTags(input: string): string[] {
  const seen = new Set<string>();
  for (const raw of input.split(/[,\s]+/)) {
    const v = raw.trim().toLowerCase().replace(/\s+/g, '-');
    if (v && /^[a-z0-9][a-z0-9-]{0,31}$/.test(v)) seen.add(v);
  }
  return [...seen].sort();
}

export default function SavedPage() {
  const [rows, setRows] = useState<Combined[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<{ id: string; added: number; removed: number } | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editQuery, setEditQuery] = useState('');
  const [editTags, setEditTags] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

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

  const allTags = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) for (const t of r.saved.tags ?? []) c.set(t, (c.get(t) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows]);

  const visible = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterTag && !(r.saved.tags ?? []).includes(filterTag)) return false;
      if (!q) return true;
      return (
        r.saved.title.toLowerCase().includes(q) ||
        r.saved.query.toLowerCase().includes(q) ||
        (r.saved.tags ?? []).some((t) => t.includes(q))
      );
    });
  }, [rows, filterTag, filterText]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !query.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      await api.saveSearch({
        title: title.trim(),
        query: query.trim(),
        tags: normalizeTags(tagsInput),
      });
      setTitle('');
      setQuery('');
      setTagsInput('');
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

  function startEdit(s: SavedSearch) {
    setEditId(s.id);
    setEditTitle(s.title);
    setEditQuery(s.query);
    setEditTags((s.tags ?? []).join(' '));
  }

  function cancelEdit() {
    setEditId(null);
    setEditTitle('');
    setEditQuery('');
    setEditTags('');
  }

  async function saveEdit() {
    if (!editId || !editTitle.trim() || !editQuery.trim() || savingEdit) return;
    setSavingEdit(true);
    setError(null);
    try {
      await api.updateSaved(editId, {
        title: editTitle.trim(),
        query: editQuery.trim(),
        tags: normalizeTags(editTags),
      });
      cancelEdit();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function removeTag(s: SavedSearch, tag: string) {
    const next = (s.tags ?? []).filter((t) => t !== tag);
    try {
      await api.updateSaved(s.id, { tags: next });
      await load();
    } catch (err) {
      setError((err as Error).message);
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
              Reusable queries with tags. Run a digest to see what is new since the last time you checked.
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
              aria-label="Title"
              className="rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cm-accent"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Query, e.g. recent commits about ingest"
              aria-label="Query"
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
          <div className="mt-2">
            <input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="Tags (space or comma separated, e.g. work ops)"
              aria-label="Tags"
              className="w-full rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cm-accent"
            />
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

        {rows.length > 0 && (
          <div className="mt-5 cm-card p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <input
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filter by title, query, or tag"
                aria-label="Filter saved searches"
                className="w-full max-w-sm rounded-md border border-cm-border bg-cm-bg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-cm-accent"
              />
              <span className="text-xs text-cm-muted">
                {visible.length} of {rows.length}
              </span>
            </div>
            {allTags.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-cm-muted">tags</span>
                <button
                  onClick={() => setFilterTag(null)}
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    filterTag === null
                      ? 'border-cm-accent text-cm-accent'
                      : 'border-cm-border text-cm-muted hover:text-cm-fg'
                  }`}
                >
                  all
                </button>
                {allTags.map(([t, n]) => (
                  <button
                    key={t}
                    onClick={() => setFilterTag(filterTag === t ? null : t)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                      filterTag === t
                        ? 'border-cm-accent text-cm-accent'
                        : 'border-cm-border text-cm-muted hover:text-cm-fg'
                    }`}
                  >
                    <IconTag size={10} />
                    {t}
                    <span className="text-cm-muted/70">{n}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-5">
          {loading && rows.length === 0 ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : rows.length === 0 ? (
            <EmptyState
              title="No saved searches"
              body="Save your first query above. Add tags like 'work' or 'ops' to group them."
            />
          ) : visible.length === 0 ? (
            <EmptyState
              title="No matches"
              body="Clear the filter or pick a different tag."
            />
          ) : (
            <ul className="cm-card divide-y divide-cm-border">
              {visible.map(({ saved, digest }) => {
                const isEditing = editId === saved.id;
                return (
                  <li key={saved.id} className="p-4">
                    {isEditing ? (
                      <div className="flex flex-col gap-2">
                        <input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          aria-label="Edit title"
                          className="rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cm-accent"
                        />
                        <input
                          value={editQuery}
                          onChange={(e) => setEditQuery(e.target.value)}
                          aria-label="Edit query"
                          className="rounded-md border border-cm-border bg-cm-bg px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-cm-accent"
                        />
                        <input
                          value={editTags}
                          onChange={(e) => setEditTags(e.target.value)}
                          placeholder="Tags (space or comma separated)"
                          aria-label="Edit tags"
                          className="rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-cm-accent"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={saveEdit}
                            disabled={savingEdit || !editTitle.trim() || !editQuery.trim()}
                            className="inline-flex items-center gap-1.5 rounded-md bg-cm-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                          >
                            {savingEdit ? <Spinner size={14} /> : <IconCheck size={14} />}
                            Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <IconBook size={14} className="text-cm-muted shrink-0" />
                            <span className="truncate text-sm font-medium">{saved.title}</span>
                          </div>
                          <div className="mt-1 truncate font-mono text-xs text-cm-muted">{saved.query}</div>
                          {(saved.tags ?? []).length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {(saved.tags ?? []).map((t) => (
                                <button
                                  key={t}
                                  onClick={() => removeTag(saved, t)}
                                  title={`Click to remove tag '${t}'`}
                                  className="inline-flex items-center gap-1 rounded-full border border-cm-border px-2 py-0.5 text-xs text-cm-muted hover:border-cm-danger hover:text-cm-danger"
                                >
                                  <IconTag size={10} /> {t}
                                </button>
                              ))}
                            </div>
                          )}
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
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
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
                            onClick={() => startEdit(saved)}
                            aria-label="Edit"
                            className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
                            title="Rename or edit tags"
                          >
                            <IconPencil size={14} />
                          </button>
                          <button
                            onClick={() => remove(saved.id)}
                            aria-label="Delete"
                            className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2 py-1.5 text-sm text-cm-muted hover:text-cm-danger"
                            title="Delete"
                          >
                            <IconTrash size={14} />
                          </button>
                        </div>
                      </div>
                    )}
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
