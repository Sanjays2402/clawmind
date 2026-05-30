'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { TopNav } from '@/components/TopNav';
import { api, fmtRelative, type SnapshotSummary, type SavedSearch } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconArrowRight,
  IconBook,
} from '@clawmind/ui';

const CaptureIcon = IconPlus;

export default function SnapshotsListPage() {
  const params = useParams<{ id: string }>();
  const savedId = params.id;

  const [items, setItems] = useState<SnapshotSummary[]>([]);
  const [saved, setSaved] = useState<SavedSearch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [capturing, setCapturing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, all] = await Promise.all([
        api.snapshotsList(savedId),
        api.savedList().catch(() => [] as SavedSearch[]),
      ]);
      list.sort((a, b) => b.ts - a.ts);
      setItems(list);
      setSaved(all.find((s) => s.id === savedId) ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [savedId]);
  useEffect(() => { load(); }, [load]);

  async function capture(e: React.FormEvent) {
    e.preventDefault();
    if (capturing) return;
    setCapturing(true);
    setError(null);
    try {
      await api.snapshotCapture(savedId, label.trim() ? { label: label.trim() } : {});
      setLabel('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCapturing(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this snapshot? The diff history will lose it.')) return;
    try {
      await api.snapshotDelete(savedId, id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <div className="text-xs text-cm-muted">
          <Link href="/saved" className="text-cm-accent">Saved searches</Link> / Snapshots
        </div>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">
              {saved?.title ?? 'Snapshots'}
            </h1>
            {saved && (
              <div className="mt-1 truncate font-mono text-xs text-cm-muted">{saved.query}</div>
            )}
            <p className="mt-1 text-sm text-cm-muted">
              Captures of the top sources for this saved query. Diff a snapshot against the latest run to see what shifted.
            </p>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 self-start rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
          >
            <IconRefresh size={14} /> Refresh
          </button>
        </div>

        <form onSubmit={capture} className="mt-5 cm-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CaptureIcon size={16} /> Capture snapshot
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label, optional (e.g. before-refactor)"
              className="rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cm-accent"
            />
            <button
              type="submit"
              disabled={capturing}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-cm-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {capturing ? <Spinner size={14} /> : <IconPlus size={14} />}
              Capture
            </button>
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
              title="No snapshots yet"
              body="Capture one above. Later runs can be diffed against any snapshot you keep."
            />
          ) : (
            <ul className="cm-card divide-y divide-cm-border">
              {items.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <IconBook size={14} className="text-cm-muted" />
                      <span className="truncate text-sm font-medium">
                        {s.label ?? new Date(s.ts).toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 text-xs text-cm-muted">
                      <span>captured {fmtRelative(s.ts)}</span>
                      <span>{s.sourceCount} sources</span>
                      <span className="font-mono">{s.id.slice(0, 8)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Link
                      href={`/saved/${savedId}/snapshots/${s.id}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm hover:text-cm-fg"
                    >
                      Open diff <IconArrowRight size={14} />
                    </Link>
                    <button
                      onClick={() => remove(s.id)}
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
