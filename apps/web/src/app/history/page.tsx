'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, fmtRelative, API_BASE, type HistoryItem, type Source } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconSpark,
  IconSearch,
  IconArrowRight,
  IconFolder,
  IconChat,
  IconRefresh,
} from '@clawmind/ui';

type Ns = 'memory' | 'sessions' | 'projects' | 'docs' | 'misc';
const ALL_NS: Ns[] = ['memory', 'sessions', 'projects', 'docs', 'misc'];

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [namespaces, setNamespaces] = useState<Ns[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .history({
        q: debounced || undefined,
        namespaces: namespaces.length ? namespaces : undefined,
        limit: 200,
      })
      .then((rows) => {
        if (cancelled) return;
        setItems(rows);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debounced, namespaces]);

  const stats = useMemo(() => {
    if (!items.length) return null;
    const models = new Map<string, number>();
    let totalSources = 0;
    for (const it of items) {
      models.set(it.model || 'unknown', (models.get(it.model || 'unknown') ?? 0) + 1);
      totalSources += it.sources?.length ?? 0;
    }
    const topModel = [...models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return {
      count: items.length,
      avgSources: items.length ? Math.round((totalSources / items.length) * 10) / 10 : 0,
      topModel,
    };
  }, [items]);

  function toggleNs(ns: Ns) {
    setNamespaces((prev) => (prev.includes(ns) ? prev.filter((n) => n !== ns) : [...prev, ns]));
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopNav />
      <main style={{ maxWidth: 980, margin: '0 auto', padding: '32px 24px 96px' }}>
        <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <h1 className="cm-display" style={{ fontSize: 32, fontWeight: 500, margin: 0, letterSpacing: -0.3 }}>
              History
            </h1>
            <p style={{ color: 'var(--cm-muted)', marginTop: 6, fontSize: 14 }}>
              Every question you have asked, with the answer and the files that grounded it.
            </p>
          </div>
          {stats && (
            <div style={{ display: 'flex', gap: 18, fontSize: 12, color: 'var(--cm-muted)' }}>
              <Stat label="answers" value={String(stats.count)} />
              <Stat label="avg sources" value={String(stats.avgSources)} />
              {stats.topModel && <Stat label="top model" value={stats.topModel} />}
            </div>
          )}
        </header>

        <div
          style={{
            marginTop: 24,
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <label
            style={{
              flex: '1 1 280px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--cm-subtle)',
              border: '1px solid var(--cm-border)',
              borderRadius: 10,
              padding: '8px 12px',
            }}
          >
            <IconSearch />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search past questions and answers"
              aria-label="Search history"
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--cm-fg)',
                fontFamily: 'var(--cm-font)',
                fontSize: 14,
              }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--cm-muted)',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                clear
              </button>
            )}
          </label>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ALL_NS.map((ns) => {
              const active = namespaces.includes(ns);
              return (
                <button
                  key={ns}
                  onClick={() => toggleNs(ns)}
                  aria-pressed={active}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 999,
                    fontSize: 12,
                    cursor: 'pointer',
                    border: '1px solid var(--cm-border)',
                    background: active ? 'var(--cm-accent)' : 'var(--cm-subtle)',
                    color: active ? 'white' : 'var(--cm-fg)',
                    fontFamily: 'var(--cm-font)',
                  }}
                >
                  {ns}
                </button>
              );
            })}
          </div>

          <ExportMenu
            disabled={loading || items.length === 0}
            query={debounced}
            namespaces={namespaces}
            count={items.length}
          />
        </div>

        {error && (
          <div style={{ marginTop: 24 }}>
            <ErrorState title="Could not load history" message={error} />
          </div>
        )}

        {loading && (
          <div style={{ marginTop: 32, display: 'grid', gap: 12 }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  height: 92,
                  borderRadius: 12,
                  border: '1px solid var(--cm-border)',
                  background: 'linear-gradient(90deg, var(--cm-subtle), var(--cm-paper), var(--cm-subtle))',
                  backgroundSize: '200% 100%',
                  animation: 'cm-skeleton 1.4s ease-in-out infinite',
                }}
              />
            ))}
            <style>{`@keyframes cm-skeleton { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }`}</style>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--cm-muted)', fontSize: 13 }}>
              <Spinner /> loading history
            </div>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div style={{ marginTop: 32 }}>
            <EmptyState
              icon={<IconSpark />}
              title={debounced || namespaces.length ? 'Nothing matches those filters' : 'No questions yet'}
              body={
                debounced || namespaces.length
                  ? 'Try a broader search or clear the namespace filters.'
                  : 'Ask something on the chat page and it will land here with the cited sources.'
              }
            />
            {!debounced && !namespaces.length && (
              <div style={{ marginTop: 14, textAlign: 'center' }}>
                <Link
                  href="/chat"
                  style={{
                    padding: '8px 14px',
                    background: 'var(--cm-accent)',
                    color: 'white',
                    borderRadius: 8,
                    fontSize: 14,
                    textDecoration: 'none',
                  }}
                >
                  Open chat
                </Link>
              </div>
            )}
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '24px 0 0', display: 'grid', gap: 10 }}>
            {items.map((it) => (
              <HistoryRow
                key={it.id}
                item={it}
                open={openId === it.id}
                onToggle={() => setOpenId((cur) => (cur === it.id ? null : it.id))}
                onDelete={async () => {
                  const ok = typeof window !== 'undefined'
                    ? window.confirm('Delete this history entry? This cannot be undone.')
                    : true;
                  if (!ok) return;
                  const prev = items;
                  setItems((cur) => cur.filter((x) => x.id !== it.id));
                  if (openId === it.id) setOpenId(null);
                  try {
                    await api.removeHistoryItem(it.id);
                  } catch (e) {
                    setItems(prev);
                    setError((e as Error).message);
                  }
                }}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function ExportMenu({
  disabled,
  query,
  namespaces,
  count,
}: {
  disabled: boolean;
  query: string;
  namespaces: string[];
  count: number;
}) {
  const [open, setOpen] = useState(false);
  function url(ext: 'json' | 'csv' | 'md') {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (namespaces.length) params.set('namespaces', namespaces.join(','));
    params.set('limit', '1000');
    return `${API_BASE}/v1/history/export.${ext}?${params.toString()}`;
  }
  const baseBtn: React.CSSProperties = {
    padding: '6px 12px',
    borderRadius: 8,
    fontSize: 12,
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: '1px solid var(--cm-border)',
    background: 'var(--cm-subtle)',
    color: 'var(--cm-fg)',
    fontFamily: 'var(--cm-font)',
    opacity: disabled ? 0.5 : 1,
  };
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={count ? `Download ${count} ${count === 1 ? 'answer' : 'answers'}` : 'Nothing to export'}
        style={baseBtn}
      >
        Export {count > 0 && <span style={{ color: 'var(--cm-faint)' }}>({count})</span>}
      </button>
      {open && !disabled && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 6px)',
            background: 'var(--cm-paper)',
            border: '1px solid var(--cm-border)',
            borderRadius: 10,
            padding: 6,
            display: 'grid',
            gap: 2,
            minWidth: 200,
            zIndex: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          }}
        >
          {(['json', 'csv', 'md'] as const).map((ext) => (
            <a
              key={ext}
              role="menuitem"
              href={url(ext)}
              onClick={() => setOpen(false)}
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                fontSize: 13,
                color: 'var(--cm-fg)',
                textDecoration: 'none',
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <span>Download .{ext}</span>
              <span className="cm-mono" style={{ color: 'var(--cm-faint)', fontSize: 11 }}>
                {ext === 'json' ? 'structured' : ext === 'csv' ? 'spreadsheet' : 'notes'}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <span className="cm-mono" style={{ fontSize: 15, color: 'var(--cm-fg)' }}>{value}</span>
      <span className="cm-mono" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </span>
    </div>
  );
}

function HistoryRow({
  item,
  open,
  onToggle,
  onDelete,
}: {
  item: HistoryItem;
  open: boolean;
  onToggle: () => void;
  onDelete: () => void | Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const sources = item.sources ?? [];
  const namespaces = useMemo(() => {
    const s = new Set<string>();
    for (const src of sources) {
      const ns = (src as Source & { namespace?: string }).namespace;
      if (ns) s.add(ns);
    }
    return [...s];
  }, [sources]);

  return (
    <li style={{ border: '1px solid var(--cm-border)', borderRadius: 12, background: 'var(--cm-paper)' }}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: '100%',
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          padding: 16,
          cursor: 'pointer',
          color: 'var(--cm-fg)',
          fontFamily: 'var(--cm-font)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ fontWeight: 500, fontSize: 15, lineHeight: 1.4 }}>{item.query}</div>
          <div className="cm-mono" style={{ fontSize: 11, color: 'var(--cm-faint)', flexShrink: 0 }}>
            {fmtRelative(item.ts)}
          </div>
        </div>
        <div
          style={{
            marginTop: 8,
            color: 'var(--cm-muted)',
            fontSize: 13.5,
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            display: '-webkit-box',
            WebkitLineClamp: open ? 'unset' : 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {open ? item.answer : item.answer.slice(0, 320) + (item.answer.length > 320 ? '...' : '')}
        </div>
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 11 }}>
          <span className="cm-mono" style={{ color: 'var(--cm-faint)' }}>{item.model || 'unknown model'}</span>
          <span style={{ color: 'var(--cm-faint)' }}>·</span>
          <span className="cm-mono" style={{ color: 'var(--cm-faint)' }}>
            {sources.length} {sources.length === 1 ? 'source' : 'sources'}
          </span>
          {namespaces.map((ns) => (
            <span
              key={ns}
              style={{
                padding: '2px 8px',
                borderRadius: 999,
                background: 'var(--cm-subtle)',
                color: 'var(--cm-muted)',
                fontSize: 10.5,
              }}
            >
              {ns}
            </span>
          ))}
          <span style={{ marginLeft: 'auto', color: 'var(--cm-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {open ? 'hide' : 'expand'} <IconArrowRight />
          </span>
        </div>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--cm-border)', padding: 16, display: 'grid', gap: 14 }}>
          {sources.length > 0 ? (
            <div>
              <div
                className="cm-mono"
                style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--cm-faint)' }}
              >
                Cited sources
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: 6 }}>
                {sources.slice(0, 8).map((s, i) => (
                  <li key={s.id ?? i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12.5 }}>
                    <span
                      className="cm-mono"
                      style={{
                        minWidth: 22,
                        height: 22,
                        borderRadius: 6,
                        background: 'var(--cm-subtle)',
                        color: 'var(--cm-muted)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        flexShrink: 0,
                      }}
                    >
                      {i + 1}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="cm-mono" style={{ fontSize: 12, color: 'var(--cm-fg)', wordBreak: 'break-all' }}>
                        <IconFolder /> {s.displayPath || s.path}
                        {s.startLine ? (
                          <span style={{ color: 'var(--cm-faint)' }}>
                            {' '}
                            L{s.startLine}
                            {s.endLine && s.endLine !== s.startLine ? `-${s.endLine}` : ''}
                          </span>
                        ) : null}
                        {typeof s.score === 'number' && (
                          <span style={{ color: 'var(--cm-faint)', marginLeft: 8 }}>
                            score {s.score.toFixed(3)}
                          </span>
                        )}
                      </div>
                      {s.excerpt && (
                        <div
                          style={{
                            marginTop: 4,
                            color: 'var(--cm-muted)',
                            fontSize: 12,
                            lineHeight: 1.5,
                            background: 'var(--cm-subtle)',
                            borderRadius: 6,
                            padding: '6px 8px',
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {s.excerpt.length > 280 ? s.excerpt.slice(0, 280) + '...' : s.excerpt}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {sources.length > 8 && (
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--cm-faint)' }}>
                  + {sources.length - 8} more
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--cm-faint)' }}>No sources were cited for this answer.</div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link
              href={{ pathname: '/chat', query: { q: item.query } }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 12px',
                background: 'var(--cm-accent)',
                color: 'white',
                borderRadius: 8,
                fontSize: 13,
                textDecoration: 'none',
              }}
            >
              <IconRefresh /> Ask again
            </Link>
            <Link
              href={{ pathname: '/chat', query: { q: item.query } }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 12px',
                background: 'var(--cm-subtle)',
                color: 'var(--cm-fg)',
                borderRadius: 8,
                fontSize: 13,
                textDecoration: 'none',
                border: '1px solid var(--cm-border)',
              }}
            >
              <IconChat /> Open in chat
            </Link>
            <button
              onClick={() => {
                if (navigator?.clipboard) navigator.clipboard.writeText(item.answer);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 12px',
                background: 'var(--cm-subtle)',
                color: 'var(--cm-fg)',
                borderRadius: 8,
                fontSize: 13,
                cursor: 'pointer',
                border: '1px solid var(--cm-border)',
                fontFamily: 'var(--cm-font)',
              }}
            >
              Copy answer
            </button>
            <button
              onClick={async () => {
                if (deleting) return;
                setDeleting(true);
                try {
                  await onDelete();
                } finally {
                  setDeleting(false);
                }
              }}
              disabled={deleting}
              aria-label="Delete this history entry"
              style={{
                marginLeft: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 12px',
                background: 'transparent',
                color: 'var(--cm-muted)',
                borderRadius: 8,
                fontSize: 13,
                cursor: deleting ? 'not-allowed' : 'pointer',
                border: '1px solid var(--cm-border)',
                fontFamily: 'var(--cm-font)',
                opacity: deleting ? 0.6 : 1,
              }}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
