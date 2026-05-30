'use client';

// Aliases: short, memorable names for long source paths. Names are validated
// server-side against ALIAS_NAME_RE (a-z0-9 plus `_` and `-`, up to 32
// chars); we mirror the constraint in the client only for early feedback and
// let the API be the source of truth on rejections.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, fmtRelative, type AliasEntry } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconAt,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconArrowRight,
} from '@clawmind/ui';

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export default function AliasesPage() {
  const [items, setItems] = useState<AliasEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [creating, setCreating] = useState(false);
  const [removingName, setRemovingName] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.aliasesList());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const nameValid = name === '' || NAME_RE.test(name);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !path.trim() || creating || !NAME_RE.test(name.trim())) return;
    setCreating(true);
    setError(null);
    try {
      await api.aliasAdd(name.trim(), path.trim());
      setName('');
      setPath('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function remove(n: string) {
    if (!confirm(`Remove alias @${n}?`)) return;
    setRemovingName(n);
    try {
      await api.aliasRemove(n);
      setItems((cur) => cur.filter((it) => it.name !== n));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRemovingName(null);
    }
  }

  return (
    <main className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Aliases</h1>
            <p className="mt-1 text-sm text-cm-muted">
              Short names that resolve to long source paths. Used to rewrite queries
              and to label citations in answers.
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
            <IconPlus size={16} /> Add alias
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <div className="flex flex-col">
              <input
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase())}
                placeholder="name (e.g. arch)"
                className={[
                  'rounded-md border bg-cm-bg px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-cm-accent',
                  nameValid ? 'border-cm-border' : 'border-cm-danger',
                ].join(' ')}
                maxLength={32}
              />
              {!nameValid && (
                <span className="mt-1 text-xs text-cm-danger">
                  Use a-z, 0-9, underscore, or hyphen. Up to 32 chars.
                </span>
              )}
            </div>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="path, e.g. docs/architecture.md"
              className="rounded-md border border-cm-border bg-cm-bg px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-cm-accent"
            />
            <button
              type="submit"
              disabled={creating || !name.trim() || !path.trim() || !nameValid}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-cm-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {creating ? <Spinner size={14} /> : <IconPlus size={14} />}
              Save
            </button>
          </div>
          <p className="mt-2 text-xs text-cm-muted">
            Reusing a name overwrites the existing target path.
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
              title="No aliases yet"
              body="Add an alias above to give a long path a short, memorable handle."
            />
          ) : (
            <ul className="cm-card divide-y divide-cm-border">
              {items.map((a) => (
                <li key={a.name} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <IconAt size={14} className="text-cm-accent" />
                      <span className="font-mono text-sm">{a.name}</span>
                      <span className="text-cm-muted">to</span>
                      <Link
                        href={{ pathname: '/sources/view', query: { path: a.path } }}
                        className="truncate font-mono text-sm hover:underline"
                        title={a.path}
                      >
                        {a.path}
                      </Link>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-cm-muted">
                      <span>added {fmtRelative(a.createdAt)}</span>
                      <span>by {a.createdBy}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Link
                      href={{ pathname: '/sources/view', query: { path: a.path } }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm hover:text-cm-fg"
                    >
                      <IconArrowRight size={14} /> Open
                    </Link>
                    <button
                      onClick={() => remove(a.name)}
                      disabled={removingName === a.name}
                      className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2 py-1.5 text-sm text-cm-muted hover:text-cm-danger disabled:opacity-50"
                      title="Remove alias"
                    >
                      {removingName === a.name ? <Spinner size={14} /> : <IconTrash size={14} />}
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
