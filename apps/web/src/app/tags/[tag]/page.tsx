'use client';

// Tag detail: shows every source path carrying a given tag. The tag itself is
// passed via the dynamic route segment; we URL-decode once so the displayed
// label matches the underlying record. Each row links into the source viewer
// so the operator can confirm or relabel material in two clicks.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { TopNav } from '@/components/TopNav';
import { api } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconTag,
  IconArrowRight,
  IconRefresh,
} from '@clawmind/ui';

export default function TagDetailPage() {
  const params = useParams<{ tag: string }>();
  const tag = decodeURIComponent(params.tag ?? '');

  const [paths, setPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tag) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.tagDetail(tag);
      setPaths(res.paths);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tag]);
  useEffect(() => { load(); }, [load]);

  return (
    <main className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="text-xs text-cm-muted">
              <Link href="/tags" className="hover:text-cm-fg">Tags</Link>
              <span className="mx-1.5">/</span>
              <span className="font-mono">{tag}</span>
            </div>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <IconTag size={20} className="text-cm-accent" />
              <span className="truncate font-mono">{tag}</span>
            </h1>
            <p className="mt-1 text-sm text-cm-muted">
              Sources carrying this tag. Open a source to view it or change its labels.
            </p>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 self-start rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
          >
            <IconRefresh size={14} /> Refresh
          </button>
        </div>

        {error && (
          <div className="mt-4">
            <ErrorState message={error} onRetry={load} />
          </div>
        )}

        <div className="mt-5">
          {loading && paths.length === 0 ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : paths.length === 0 ? (
            <EmptyState
              title="No sources carry this tag"
              body="Either the tag was just emptied or it was deleted from every path. Head back to the tag list to pick another."
            />
          ) : (
            <ul className="cm-card divide-y divide-cm-border">
              {paths.map((p) => (
                <li key={p} className="flex items-center justify-between gap-3 p-4">
                  <Link
                    href={{ pathname: '/sources/view', query: { path: p } }}
                    className="min-w-0 flex-1 truncate font-mono text-sm hover:underline"
                    title={p}
                  >
                    {p}
                  </Link>
                  <Link
                    href={{ pathname: '/sources/view', query: { path: p } }}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
                  >
                    <IconArrowRight size={14} /> Open
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
