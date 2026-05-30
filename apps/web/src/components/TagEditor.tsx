'use client';

// Per-path tag editor. Loads the current tag set for `path`, lets the
// operator add a tag (Enter or click) or remove an existing one. All writes
// go through the same /v1/tags/by-path endpoints that the rest of the app
// uses, so a removal here is reflected on /tags and on retrieval immediately.

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Spinner, IconTag, IconPlus, IconTrash } from '@clawmind/ui';

const TAG_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

export function TagEditor({ path }: { path: string }) {
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.tagsForPath(path);
      setTags(res.tags);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => { load(); }, [load]);

  async function add(e?: React.FormEvent) {
    e?.preventDefault();
    const t = draft.trim().toLowerCase();
    if (!t || busy) return;
    if (!TAG_RE.test(t)) {
      setError('Tag must be lowercase alphanumeric with . _ or -, up to 64 chars.');
      return;
    }
    if (tags.includes(t)) {
      setDraft('');
      return;
    }
    setBusy('__add');
    setError(null);
    try {
      const res = await api.tagsAddForPath(path, [t]);
      setTags(res.tags);
      setDraft('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(t: string) {
    setBusy(t);
    setError(null);
    try {
      const res = await api.tagsRemoveForPath(path, [t]);
      setTags(res.tags);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-[10px] border border-cm-border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <IconTag size={16} /> Tags
      </div>

      <div className="mt-2.5 flex flex-wrap gap-2">
        {loading ? (
          <Spinner size={14} />
        ) : tags.length === 0 ? (
          <span className="text-xs text-cm-muted">No tags. Add one to group this source with related material.</span>
        ) : (
          tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full border border-cm-border bg-cm-subtle px-2 py-0.5 text-xs"
            >
              <span className="font-mono">{t}</span>
              <button
                onClick={() => remove(t)}
                disabled={busy === t}
                aria-label={`Remove tag ${t}`}
                className="text-cm-muted hover:text-cm-danger disabled:opacity-50"
              >
                {busy === t ? <Spinner size={10} /> : <IconTrash size={10} />}
              </button>
            </span>
          ))
        )}
      </div>

      <form onSubmit={add} className="mt-3 flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="add a tag and press Enter"
          maxLength={64}
          className="flex-1 rounded-md border border-cm-border bg-cm-bg px-3 py-1.5 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-cm-accent"
        />
        <button
          type="submit"
          disabled={!draft.trim() || busy === '__add'}
          className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2.5 py-1.5 text-xs hover:text-cm-fg disabled:opacity-50"
        >
          {busy === '__add' ? <Spinner size={12} /> : <IconPlus size={12} />}
          Add
        </button>
      </form>

      {error && (
        <div className="mt-2 text-xs text-cm-danger">{error}</div>
      )}
    </div>
  );
}
