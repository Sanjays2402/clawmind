'use client';
import { useState } from 'react';
import { TopNav } from '@/components/TopNav';
import { api, type Source } from '@/lib/api';
import { HighlightedText } from '@/components/SourcesPane';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconSearch,
  IconFolder,
  IconArrowRight,
} from '@clawmind/ui';
import Link from 'next/link';

export default function SearchPage() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim() || loading) return;
    setLoading(true);
    setError(null);
    setSubmitted(true);
    try {
      const res = await api.search({ q: q.trim(), k: 12, highlight: true });
      setHits(res.hits);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <div className="flex items-end justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
            <p className="mt-1 text-sm text-cm-muted">
              Hybrid retrieval over your workspace. Matching terms are highlighted in each snippet.
            </p>
          </div>
          <Link
            href="/chat"
            className="inline-flex items-center gap-1.5 self-start rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
          >
            Ask instead <IconArrowRight size={14} />
          </Link>
        </div>

        <form onSubmit={run} className="mt-5 flex items-center gap-2">
          <div className="relative flex-1">
            <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cm-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="What are you looking for?"
              autoFocus
              className="w-full rounded-md border border-cm-border bg-cm-subtle py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-cm-accent"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !q.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-cm-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? <Spinner size={14} /> : <IconSearch size={14} />}
            Search
          </button>
        </form>

        <div className="mt-5">
          {loading && hits.length === 0 ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : error ? (
            <ErrorState message={error} onRetry={() => setError(null)} retryLabel="Dismiss" />
          ) : !submitted ? (
            <EmptyState
              title="Type a query"
              body="Try a phrase, an identifier, a path fragment. Results stay on this machine."
            />
          ) : hits.length === 0 ? (
            <EmptyState
              title="Nothing matched"
              body="Try fewer or broader terms, or check that you have indexed the right namespace."
            />
          ) : (
            <ul className="cm-card divide-y divide-cm-border">
              {hits.map((h, i) => (
                <li key={h.id + i} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-cm-muted">
                      <IconFolder size={14} />
                      <span className="font-mono">{h.displayPath ?? h.path}:{h.startLine}</span>
                    </div>
                    <span className="text-xs text-cm-muted">score {h.score.toFixed(3)}</span>
                  </div>
                  <div className="mt-2 text-sm leading-relaxed">
                    {h.snippet && h.snippet.text ? (
                      <HighlightedText text={h.snippet.text} spans={h.snippet.spans} />
                    ) : (
                      h.excerpt
                    )}
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
