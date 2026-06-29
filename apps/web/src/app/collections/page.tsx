'use client';

// Collections group saved searches into named folders. The page handles the
// full lifecycle: create, rename, recolor, delete, and a per-collection
// drawer for assigning or removing saved searches without leaving the page.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  fmtRelative,
  type Collection,
  type CollectionColor,
  type SavedSearch,
} from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconFolder,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconPencil,
  IconCheck,
  IconBook,
  IconArrowRight,
} from '@clawmind/ui';

const COLORS: CollectionColor[] = ['slate', 'violet', 'emerald', 'amber', 'rose', 'sky'];

// Tailwind cannot see dynamic class names, so map each palette entry to a
// concrete pair of tokens the build retains.
const COLOR_CLASS: Record<CollectionColor, { dot: string; ring: string; text: string }> = {
  slate: { dot: 'bg-slate-400', ring: 'ring-slate-400/40', text: 'text-slate-500' },
  violet: { dot: 'bg-violet-500', ring: 'ring-violet-500/40', text: 'text-violet-500' },
  emerald: { dot: 'bg-emerald-500', ring: 'ring-emerald-500/40', text: 'text-emerald-500' },
  amber: { dot: 'bg-amber-500', ring: 'ring-amber-500/40', text: 'text-amber-500' },
  rose: { dot: 'bg-rose-500', ring: 'ring-rose-500/40', text: 'text-rose-500' },
  sky: { dot: 'bg-sky-500', ring: 'ring-sky-500/40', text: 'text-sky-500' },
};

interface FormState {
  name: string;
  description: string;
  color: CollectionColor;
}

const EMPTY_FORM: FormState = { name: '', description: '', color: 'slate' };

export default function CollectionsPage() {
  const [items, setItems] = useState<Collection[]>([]);
  const [savedAll, setSavedAll] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [savingEdit, setSavingEdit] = useState(false);

  const [openId, setOpenId] = useState<string | null>(null);
  const [openMembers, setOpenMembers] = useState<Set<string>>(new Set());
  const [openLoading, setOpenLoading] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [memberFilter, setMemberFilter] = useState('');

  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cols, saved] = await Promise.all([
        api.collectionsList(),
        api.savedList().catch(() => [] as SavedSearch[]),
      ]);
      setItems(cols);
      setSavedAll(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      await api.collectionCreate({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        color: form.color,
      });
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function startEdit(c: Collection) {
    setEditId(c.id);
    setEditForm({ name: c.name, description: c.description, color: c.color });
  }

  async function saveEdit(id: string) {
    if (!editForm.name.trim() || savingEdit) return;
    setSavingEdit(true);
    setError(null);
    try {
      await api.collectionUpdate(id, {
        name: editForm.name.trim(),
        description: editForm.description.trim(),
        color: editForm.color,
      });
      setEditId(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function remove(c: Collection) {
    if (!confirm(`Delete the collection "${c.name}"? Saved searches inside it stay; only the grouping is removed.`)) return;
    setRemovingId(c.id);
    try {
      await api.collectionDelete(c.id);
      setItems((cur) => cur.filter((it) => it.id !== c.id));
      if (openId === c.id) setOpenId(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRemovingId(null);
    }
  }

  const openCollection = useCallback(
    async (c: Collection) => {
      if (openId === c.id) {
        setOpenId(null);
        return;
      }
      setOpenId(c.id);
      setOpenLoading(true);
      setOpenError(null);
      setMemberFilter('');
      try {
        const { items: members } = await api.collectionGet(c.id);
        setOpenMembers(new Set(members.map((m) => m.id)));
      } catch (err) {
        setOpenError((err as Error).message);
      } finally {
        setOpenLoading(false);
      }
    },
    [openId],
  );

  async function toggleMember(collectionId: string, savedId: string, isMember: boolean) {
    // Optimistic toggle so the checkbox feels instant. We roll back on error.
    const next = new Set(openMembers);
    if (isMember) next.delete(savedId);
    else next.add(savedId);
    setOpenMembers(next);
    try {
      if (isMember) {
        await api.collectionRemoveMember(collectionId, savedId);
      } else {
        await api.collectionAddMember(collectionId, savedId);
      }
      // Refresh the per-collection count badge.
      setItems((cur) =>
        cur.map((c) =>
          c.id === collectionId
            ? { ...c, itemCount: (c.itemCount ?? 0) + (isMember ? -1 : 1) }
            : c,
        ),
      );
    } catch (err) {
      setOpenMembers(openMembers);
      setOpenError((err as Error).message);
    }
  }

  const filteredSaved = useMemo(() => {
    const q = memberFilter.trim().toLowerCase();
    if (!q) return savedAll;
    return savedAll.filter(
      (s) => s.title.toLowerCase().includes(q) || s.query.toLowerCase().includes(q),
    );
  }, [savedAll, memberFilter]);

  // Largest collection's member count, so the per-row size bars share one
  // scale and the biggest folder fills the rail. Min 1 keeps a lone 1-item
  // collection drawing a sliver instead of dividing by zero.
  const maxItems = useMemo(
    () => Math.max(1, ...items.map((c) => c.itemCount ?? 0)),
    [items],
  );

  return (
    <main className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Collections</h1>
            <p className="mt-1 text-sm text-cm-muted">
              Group saved searches into folders so onboarding playbooks stay separate from incident reviews.
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
            <IconPlus size={16} /> New collection
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[2fr_3fr_auto]">
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Name, e.g. Onboarding playbooks"
              maxLength={80}
              className="rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cm-accent"
            />
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Optional description"
              maxLength={280}
              className="rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cm-accent"
            />
            <button
              type="submit"
              disabled={creating || !form.name.trim()}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-cm-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {creating ? <Spinner size={14} /> : <IconFolder size={14} />}
              Create
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-cm-muted">Accent</span>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setForm((f) => ({ ...f, color: c }))}
                aria-label={`Accent ${c}`}
                aria-pressed={form.color === c}
                className={`h-5 w-5 rounded-full ${COLOR_CLASS[c].dot} ${form.color === c ? `ring-2 ring-offset-2 ring-offset-cm-bg ${COLOR_CLASS[c].ring}` : ''}`}
              />
            ))}
          </div>
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
              title="No collections yet"
              body="Create one above to group related saved searches. You can move a saved search in or out at any time."
              icon={<IconFolder size={32} />}
            />
          ) : (
            <ul className="cm-card divide-y divide-cm-border">
              {items.map((c) => {
                const isOpen = openId === c.id;
                const isEditing = editId === c.id;
                return (
                  <li key={c.id} className="flex flex-col gap-3 p-4">
                    {isEditing ? (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          value={editForm.name}
                          onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                          maxLength={80}
                          className="flex-1 rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cm-accent"
                          autoFocus
                        />
                        <input
                          value={editForm.description}
                          onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                          placeholder="Description"
                          maxLength={280}
                          className="flex-1 rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cm-accent"
                        />
                        <div className="flex items-center gap-1">
                          {COLORS.map((col) => (
                            <button
                              key={col}
                              type="button"
                              onClick={() => setEditForm((f) => ({ ...f, color: col }))}
                              aria-label={`Accent ${col}`}
                              aria-pressed={editForm.color === col}
                              className={`h-4 w-4 rounded-full ${COLOR_CLASS[col].dot} ${editForm.color === col ? `ring-2 ring-offset-1 ring-offset-cm-bg ${COLOR_CLASS[col].ring}` : ''}`}
                            />
                          ))}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => saveEdit(c.id)}
                            disabled={savingEdit || !editForm.name.trim()}
                            className="inline-flex items-center gap-1.5 rounded-md bg-cm-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
                          >
                            {savingEdit ? <Spinner size={14} /> : <IconCheck size={14} />} Save
                          </button>
                          <button
                            onClick={() => setEditId(null)}
                            className="rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <button
                          onClick={() => openCollection(c)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          aria-expanded={isOpen}
                        >
                          <span className={`h-3 w-3 shrink-0 rounded-full ${COLOR_CLASS[c.color].dot}`} aria-hidden />
                          <span className="min-w-0">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">{c.name}</span>
                              <span className="rounded-full border border-cm-border px-2 py-0.5 text-xs text-cm-muted">
                                {c.itemCount ?? 0} saved
                              </span>
                            </span>
                            {(c.itemCount ?? 0) > 0 && (
                              <span
                                className="mt-1.5 block h-1.5 w-full max-w-[180px] overflow-hidden rounded-full bg-cm-subtle"
                                aria-hidden
                                title={`${c.itemCount} of ${maxItems} in the largest collection`}
                              >
                                <span
                                  className={`block h-full rounded-full ${COLOR_CLASS[c.color].dot} transition-all duration-300`}
                                  style={{ width: `${Math.max(6, ((c.itemCount ?? 0) / maxItems) * 100)}%` }}
                                />
                              </span>
                            )}
                            {c.description && (
                              <span className="mt-0.5 line-clamp-2 block text-sm text-cm-muted">
                                {c.description}
                              </span>
                            )}
                            <span className="mt-1 block text-xs text-cm-muted">
                              updated {fmtRelative(c.updatedAt)}
                            </span>
                          </span>
                        </button>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            onClick={() => startEdit(c)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
                            title="Rename"
                          >
                            <IconPencil size={14} />
                          </button>
                          <button
                            onClick={() => remove(c)}
                            disabled={removingId === c.id}
                            className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2 py-1.5 text-sm text-cm-muted hover:text-cm-danger disabled:opacity-50"
                            title="Delete"
                          >
                            {removingId === c.id ? <Spinner size={14} /> : <IconTrash size={14} />}
                          </button>
                          <button
                            onClick={() => openCollection(c)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm hover:text-cm-fg"
                          >
                            {isOpen ? 'Close' : 'Manage'} <IconArrowRight size={14} />
                          </button>
                        </div>
                      </div>
                    )}

                    {isOpen && !isEditing && (
                      <div className="mt-1 rounded-md border border-cm-border bg-cm-bg p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs text-cm-muted">
                            Toggle any saved search to add or remove it from this collection.
                          </div>
                          <Link
                            href="/saved"
                            className="text-xs text-cm-muted hover:text-cm-fg"
                          >
                            Manage saved searches
                          </Link>
                        </div>
                        <input
                          value={memberFilter}
                          onChange={(e) => setMemberFilter(e.target.value)}
                          placeholder="Filter saved searches"
                          className="mt-3 w-full rounded-md border border-cm-border bg-cm-bg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-cm-accent"
                        />
                        {openError && (
                          <div className="mt-3">
                            <ErrorState message={openError} onRetry={() => setOpenError(null)} retryLabel="Dismiss" />
                          </div>
                        )}
                        <div className="mt-3 max-h-72 overflow-y-auto">
                          {openLoading ? (
                            <div className="flex justify-center py-6"><Spinner size={16} /></div>
                          ) : savedAll.length === 0 ? (
                            <div className="py-4 text-sm text-cm-muted">
                              You have no saved searches yet. Create one from the <Link href="/saved" className="underline">Saved page</Link>.
                            </div>
                          ) : filteredSaved.length === 0 ? (
                            <div className="py-4 text-sm text-cm-muted">No saved searches match that filter.</div>
                          ) : (
                            <ul className="divide-y divide-cm-border">
                              {filteredSaved.map((s) => {
                                const isMember = openMembers.has(s.id);
                                return (
                                  <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                                      <input
                                        type="checkbox"
                                        checked={isMember}
                                        onChange={() => toggleMember(c.id, s.id, isMember)}
                                        className="h-4 w-4 rounded border-cm-border text-cm-accent focus:ring-cm-accent"
                                      />
                                      <span className="min-w-0">
                                        <span className="flex items-center gap-2">
                                          <IconBook size={12} className={COLOR_CLASS[c.color].text} />
                                          <span className="truncate text-sm">{s.title}</span>
                                        </span>
                                        <span className="block truncate text-xs text-cm-muted" title={s.query}>
                                          {s.query}
                                        </span>
                                      </span>
                                    </label>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
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
