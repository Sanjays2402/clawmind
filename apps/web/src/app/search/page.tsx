'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
  IconTag,
  IconClockCountdown,
  IconRefresh,
} from '@clawmind/ui';
import Link from 'next/link';

const NAMESPACES = ['memory', 'projects', 'sessions', 'docs', 'misc'] as const;
type Namespace = (typeof NAMESPACES)[number];

type SortKey = 'relevance' | 'path' | 'line';

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

const RECENT_KEY = 'clawmind.search.recent';
const MAX_RECENTS = 8;
// We always pull the API's hard cap (50) so client-side pagination, sort, and
// filter chip refinement happen against a stable result set without an extra
// network round-trip on every paging click.
const FETCH_K = 50;

function readRecents(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

function writeRecents(items: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, MAX_RECENTS)));
  } catch {
    // localStorage may throw in private mode; safe to ignore.
  }
}

function parseCSV(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Filters
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [includeTags, setIncludeTags] = useState<string[]>([]);
  const [excludeTags, setExcludeTags] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [tagMode, setTagMode] = useState<'include' | 'exclude'>('include');

  // Sort + pagination
  const [sort, setSort] = useState<SortKey>('relevance');
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [page, setPage] = useState(1);

  // Recents
  const [recents, setRecents] = useState<string[]>([]);
  const [recentsOpen, setRecentsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastInitialRef = useRef<string | null>(null);

  // Load recents once on mount and pre-fetch the user's known tags so we can
  // offer a one-click chip list rather than forcing them to remember names.
  useEffect(() => {
    setRecents(readRecents());
    api
      .tagsList()
      .then((items) => setAllTags(items.map((t) => t.tag).sort()))
      .catch(() => undefined);
  }, []);

  // Global `/` shortcut to focus the search box, like Linear/Vercel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const executeSearch = useCallback(
    async (query: string, opts: {
      namespaces: Namespace[];
      includeTags: string[];
      excludeTags: string[];
    }) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      setLoading(true);
      setError(null);
      setSubmitted(true);
      setPage(1);
      try {
        const res = await api.search({
          q: trimmed,
          k: FETCH_K,
          highlight: true,
          namespaces: opts.namespaces.length ? opts.namespaces : undefined,
          includeTags: opts.includeTags.length ? opts.includeTags : undefined,
          excludeTags: opts.excludeTags.length ? opts.excludeTags : undefined,
        });
        setHits(res.hits);
        setRecents((prev) => {
          const next = [trimmed, ...prev.filter((x) => x !== trimmed)].slice(0, MAX_RECENTS);
          writeRecents(next);
          return next;
        });
      } catch (err) {
        setError((err as Error).message);
        setHits([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Hydrate state from URL on first render so shared links restore the full
  // filter set, not just the raw query.
  useEffect(() => {
    const initial = searchParams.get('q');
    if (!initial || lastInitialRef.current === initial) return;
    lastInitialRef.current = initial;
    const ns = parseCSV(searchParams.get('ns')).filter((x): x is Namespace =>
      (NAMESPACES as readonly string[]).includes(x),
    );
    const inc = parseCSV(searchParams.get('inc'));
    const exc = parseCSV(searchParams.get('exc'));
    const sortQ = searchParams.get('sort') as SortKey | null;
    const psQ = Number(searchParams.get('ps'));
    setQ(initial);
    setNamespaces(ns);
    setIncludeTags(inc);
    setExcludeTags(exc);
    if (sortQ === 'relevance' || sortQ === 'path' || sortQ === 'line') setSort(sortQ);
    if (PAGE_SIZE_OPTIONS.includes(psQ as PageSize)) setPageSize(psQ as PageSize);
    void executeSearch(initial, { namespaces: ns, includeTags: inc, excludeTags: exc });
  }, [searchParams, executeSearch]);

  function pushUrl(query: string) {
    const params = new URLSearchParams();
    params.set('q', query);
    if (namespaces.length) params.set('ns', namespaces.join(','));
    if (includeTags.length) params.set('inc', includeTags.join(','));
    if (excludeTags.length) params.set('exc', excludeTags.join(','));
    if (sort !== 'relevance') params.set('sort', sort);
    if (pageSize !== 10) params.set('ps', String(pageSize));
    router.replace(`/search?${params.toString()}`);
  }

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    if (!q.trim() || loading) return;
    setRecentsOpen(false);
    pushUrl(q);
    await executeSearch(q, { namespaces, includeTags, excludeTags });
  }

  function toggleNamespace(n: Namespace) {
    setNamespaces((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]));
  }

  function addTag() {
    const t = tagInput.trim();
    if (!t) return;
    if (tagMode === 'include') {
      setIncludeTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
      setExcludeTags((prev) => prev.filter((x) => x !== t));
    } else {
      setExcludeTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
      setIncludeTags((prev) => prev.filter((x) => x !== t));
    }
    setTagInput('');
  }

  function quickAddTag(t: string) {
    if (tagMode === 'include') {
      setIncludeTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
      setExcludeTags((prev) => prev.filter((x) => x !== t));
    } else {
      setExcludeTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
      setIncludeTags((prev) => prev.filter((x) => x !== t));
    }
  }

  function clearFilters() {
    setNamespaces([]);
    setIncludeTags([]);
    setExcludeTags([]);
    setSort('relevance');
  }

  function clearRecents() {
    writeRecents([]);
    setRecents([]);
  }

  const filtersActive =
    namespaces.length + includeTags.length + excludeTags.length > 0 || sort !== 'relevance';

  const sortedHits = useMemo(() => {
    if (sort === 'relevance') return hits;
    const copy = [...hits];
    if (sort === 'path') {
      copy.sort((a, b) => (a.displayPath ?? a.path).localeCompare(b.displayPath ?? b.path));
    } else if (sort === 'line') {
      copy.sort((a, b) => a.startLine - b.startLine);
    }
    return copy;
  }, [hits, sort]);

  const total = sortedHits.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageHits = sortedHits.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <main className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <div className="flex items-end justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
            <p className="mt-1 text-sm text-cm-muted">
              Hybrid retrieval over your workspace. Filter by namespace and tag, then sort or paginate without re-querying.
            </p>
          </div>
          <Link
            href="/chat"
            className="inline-flex items-center gap-1.5 self-start rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
          >
            Ask instead <IconArrowRight size={14} />
          </Link>
        </div>

        <form onSubmit={run} className="mt-5 flex items-center gap-2" role="search">
          <div className="relative flex-1">
            <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cm-muted" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => setRecentsOpen(recents.length > 0)}
              onBlur={() => setTimeout(() => setRecentsOpen(false), 120)}
              placeholder="What are you looking for?  (press / to focus)"
              autoFocus
              aria-label="Search query"
              className="w-full rounded-md border border-cm-border bg-cm-subtle py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-cm-accent"
            />
            {recentsOpen && recents.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-cm-border bg-cm-bg shadow-lg">
                <div className="flex items-center justify-between border-b border-cm-border px-3 py-1.5 text-xs text-cm-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <IconClockCountdown size={12} /> Recent searches
                  </span>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      clearRecents();
                    }}
                    className="hover:text-cm-fg"
                  >
                    Clear
                  </button>
                </div>
                <ul className="max-h-60 overflow-y-auto py-1 text-sm">
                  {recents.map((r) => (
                    <li key={r}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setQ(r);
                          setRecentsOpen(false);
                          pushUrl(r);
                          void executeSearch(r, { namespaces, includeTags, excludeTags });
                        }}
                        className="block w-full truncate px-3 py-1.5 text-left hover:bg-cm-subtle"
                      >
                        {r}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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

        {/* Filters */}
        <section
          aria-label="Search filters"
          className="cm-card mt-4 flex flex-col gap-3 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-cm-muted">Filters</div>
            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2 py-1 text-xs text-cm-muted hover:text-cm-fg"
              >
                <IconRefresh size={12} /> Reset
              </button>
            )}
          </div>

          {/* Namespaces */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-cm-muted">Namespace</span>
            {NAMESPACES.map((n) => {
              const active = namespaces.includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => toggleNamespace(n)}
                  aria-pressed={active}
                  className={
                    'rounded-full border px-2.5 py-1 text-xs ' +
                    (active
                      ? 'border-cm-accent bg-cm-accent text-white'
                      : 'border-cm-border text-cm-muted hover:text-cm-fg')
                  }
                >
                  {n}
                </button>
              );
            })}
          </div>

          {/* Tag input + chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-cm-muted">Tags</span>
            <div className="inline-flex overflow-hidden rounded-md border border-cm-border text-xs">
              <button
                type="button"
                onClick={() => setTagMode('include')}
                className={
                  'px-2 py-1 ' + (tagMode === 'include' ? 'bg-cm-accent text-white' : 'text-cm-muted')
                }
                aria-pressed={tagMode === 'include'}
              >
                Include
              </button>
              <button
                type="button"
                onClick={() => setTagMode('exclude')}
                className={
                  'px-2 py-1 ' + (tagMode === 'exclude' ? 'bg-cm-accent text-white' : 'text-cm-muted')
                }
                aria-pressed={tagMode === 'exclude'}
              >
                Exclude
              </button>
            </div>
            <div className="relative">
              <IconTag size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-cm-muted" />
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="Add a tag"
                aria-label="Tag filter"
                list="clawmind-tags"
                className="rounded-md border border-cm-border bg-cm-subtle py-1 pl-6 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-cm-accent"
              />
              <datalist id="clawmind-tags">
                {allTags.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <button
              type="button"
              onClick={addTag}
              disabled={!tagInput.trim()}
              className="rounded-md border border-cm-border px-2 py-1 text-xs text-cm-muted hover:text-cm-fg disabled:opacity-40"
            >
              Add
            </button>
          </div>

          {(includeTags.length > 0 || excludeTags.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {includeTags.map((t) => (
                <span
                  key={'i-' + t}
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300"
                >
                  +{t}
                  <button
                    type="button"
                    onClick={() => setIncludeTags((prev) => prev.filter((x) => x !== t))}
                    aria-label={`Remove include tag ${t}`}
                    className="text-emerald-200/80 hover:text-white"
                  >
                    ×
                  </button>
                </span>
              ))}
              {excludeTags.map((t) => (
                <span
                  key={'e-' + t}
                  className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-xs text-rose-300"
                >
                  -{t}
                  <button
                    type="button"
                    onClick={() => setExcludeTags((prev) => prev.filter((x) => x !== t))}
                    aria-label={`Remove exclude tag ${t}`}
                    className="text-rose-200/80 hover:text-white"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-cm-muted">Popular</span>
              {allTags.slice(0, 10).map((t) => (
                <button
                  key={'p-' + t}
                  type="button"
                  onClick={() => quickAddTag(t)}
                  className="rounded-full border border-cm-border px-2 py-0.5 text-xs text-cm-muted hover:text-cm-fg"
                >
                  {t}
                </button>
              ))}
            </div>
          )}

          {/* Sort + page size */}
          <div className="flex flex-wrap items-center gap-3 border-t border-cm-border pt-3 text-xs text-cm-muted">
            <label className="inline-flex items-center gap-1.5">
              Sort
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="rounded-md border border-cm-border bg-cm-subtle px-2 py-1 text-xs text-cm-fg focus:outline-none focus:ring-1 focus:ring-cm-accent"
              >
                <option value="relevance">Relevance</option>
                <option value="path">Path A to Z</option>
                <option value="line">Line number</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5">
              Per page
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value) as PageSize);
                  setPage(1);
                }}
                className="rounded-md border border-cm-border bg-cm-subtle px-2 py-1 text-xs text-cm-fg focus:outline-none focus:ring-1 focus:ring-cm-accent"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {submitted && !loading && !error && (
              <span>
                {total === 0
                  ? 'No results'
                  : `Showing ${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, total)} of ${total}`}
              </span>
            )}
          </div>
        </section>

        {/* Results */}
        <div className="mt-5">
          {loading && hits.length === 0 ? (
            <ul className="cm-card divide-y divide-cm-border" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <li key={i} className="space-y-2 p-4">
                  <div className="h-3 w-1/3 animate-pulse rounded bg-cm-subtle" />
                  <div className="h-3 w-full animate-pulse rounded bg-cm-subtle" />
                  <div className="h-3 w-5/6 animate-pulse rounded bg-cm-subtle" />
                </li>
              ))}
            </ul>
          ) : error ? (
            <ErrorState
              message={error}
              onRetry={() => {
                setError(null);
                void run();
              }}
              retryLabel="Try again"
            />
          ) : !submitted ? (
            <EmptyState
              title="Type a query"
              body="Try a phrase, an identifier, a path fragment. Add tags or pick a namespace to narrow it."
            />
          ) : total === 0 ? (
            <EmptyState
              title="Nothing matched"
              body="Broaden the query, remove an exclude tag, or clear the namespace filter."
            />
          ) : (
            <>
              <ul className="cm-card divide-y divide-cm-border">
                {pageHits.map((h, i) => (
                  <li key={h.id + '-' + i} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs text-cm-muted">
                        <IconFolder size={14} />
                        <span className="font-mono">
                          {h.displayPath ?? h.path}:{h.startLine}
                        </span>
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

              {pageCount > 1 && (
                <nav
                  aria-label="Search result pages"
                  className="mt-4 flex items-center justify-between gap-3 text-sm"
                >
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    className="rounded-md border border-cm-border px-3 py-1.5 text-cm-muted hover:text-cm-fg disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-cm-muted">
                    Page {safePage} of {pageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    disabled={safePage >= pageCount}
                    className="rounded-md border border-cm-border px-3 py-1.5 text-cm-muted hover:text-cm-fg disabled:opacity-40"
                  >
                    Next
                  </button>
                </nav>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
