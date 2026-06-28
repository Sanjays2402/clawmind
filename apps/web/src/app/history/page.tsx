'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, fmtRelative, API_BASE, type HistoryItem, type Source } from '@/lib/api';
import { groupByDay } from '@/lib/dayGroups';
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
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
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
      .historyResponse({
        q: debounced || undefined,
        namespaces: namespaces.length ? namespaces : undefined,
        tags: activeTags.length ? activeTags : undefined,
        limit: 200,
      })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        if (res.availableTags) setAvailableTags(res.availableTags);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debounced, namespaces, activeTags]);

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

  // Bucket the (already newest-first) rows into per-day groups so the list
  // gets a scannable date header between days instead of being one flat run.
  const grouped = useMemo(() => groupByDay(items, (it) => it.ts), [items]);

  function toggleNs(ns: Ns) {
    setNamespaces((prev) => (prev.includes(ns) ? prev.filter((n) => n !== ns) : [...prev, ns]));
  }

  function toggleTag(tag: string) {
    setActiveTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
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

        {availableTags.length > 0 && (
          <div
            style={{
              marginTop: 12,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              alignItems: 'center',
            }}
          >
            <span
              className="cm-mono"
              style={{
                fontSize: 10.5,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--cm-faint)',
                marginRight: 4,
              }}
            >
              tags
            </span>
            {availableTags.map((t) => {
              const active = activeTags.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => toggleTag(t)}
                  aria-pressed={active}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 999,
                    fontSize: 12,
                    cursor: 'pointer',
                    border: '1px solid var(--cm-border)',
                    background: active ? 'var(--cm-accent)' : 'var(--cm-subtle)',
                    color: active ? 'white' : 'var(--cm-fg)',
                    fontFamily: 'var(--cm-font)',
                  }}
                >
                  #{t}
                </button>
              );
            })}
            {activeTags.length > 0 && (
              <button
                onClick={() => setActiveTags([])}
                style={{
                  marginLeft: 4,
                  padding: '4px 8px',
                  borderRadius: 6,
                  fontSize: 11,
                  cursor: 'pointer',
                  background: 'transparent',
                  color: 'var(--cm-muted)',
                  border: '1px solid var(--cm-border)',
                  fontFamily: 'var(--cm-font)',
                }}
              >
                clear tags
              </button>
            )}
          </div>
        )}

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
          <div style={{ margin: '24px 0 0', display: 'grid', gap: 22 }}>
            {grouped.map((group) => (
              <section key={group.dayStart}>
                <DayHeader label={group.label} count={group.items.length} items={group.items} />
                <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'grid', gap: 10 }}>
                  {group.items.map((it) => renderRow(it))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );

  function renderRow(it: HistoryItem) {
    return (
      <HistoryRow
        key={it.id}
        item={it}
        open={openId === it.id}
        onToggle={() => setOpenId((cur) => (cur === it.id ? null : it.id))}
        onRename={async (title) => {
          const prev = items;
          const trimmed = title.trim();
          setItems((cur) =>
            cur.map((x) =>
              x.id === it.id ? { ...x, title: trimmed || undefined } : x,
            ),
          );
          try {
            const res = await api.renameHistoryItem(it.id, trimmed);
            setItems((cur) =>
              cur.map((x) =>
                x.id === it.id ? { ...x, title: res.title || undefined } : x,
              ),
            );
          } catch (e) {
            setItems(prev);
            setError((e as Error).message);
          }
        }}
        onTagsChanged={(tags) => {
          setItems((cur) => cur.map((x) => (x.id === it.id ? { ...x, tags } : x)));
          setAvailableTags((cur) => {
            const next = new Set(cur);
            for (const t of tags) next.add(t);
            return Array.from(next).sort();
          });
        }}
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
    );
  }
}

/**
 * Sticky per-day header that floats just under the TopNav while its group
 * scrolls past. The count gives a quiet sense of how busy a day was; the
 * model-mix strip beside it turns that day's answers into a shape — one
 * segment per model, width proportional to how many answers it produced — so
 * a glance reads "mostly one model" vs "a real spread" without opening a row.
 */
function DayHeader({ label, count, items }: { label: string; count: number; items: HistoryItem[] }) {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 5,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 0',
        background: 'var(--cm-bg)',
      }}
    >
      <h2
        className="cm-mono"
        style={{
          margin: 0,
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--cm-faint)',
        }}
      >
        {label}
      </h2>
      <ModelMixBar items={items} />
      <span className="cm-hairline" style={{ flex: 1 }} />
      <span className="cm-mono" style={{ fontSize: 11, color: 'var(--cm-faint)' }}>
        {count}
      </span>
    </div>
  );
}

// Ordered ink palette for the model-mix segments. Drawn from the brand tokens
// (not raw colour) so the strip stays on-palette; the dominant model takes the
// accent, the rest fall to citation gold, ink-soft, muted, faint in turn.
const MODEL_INKS = [
  'var(--cm-accent)',
  'var(--cm-cite)',
  'var(--cm-fg-soft)',
  'var(--cm-muted)',
  'var(--cm-faint)',
];

/**
 * Segmented strip showing the distribution of models across a day's answers,
 * widest segment first. A single-model day reads as one solid accent bar; a
 * mixed day breaks into proportional bands. Hover any segment for the model
 * name + share; the whole strip carries an aria-label summary for SR users.
 */
function ModelMixBar({ items }: { items: HistoryItem[] }) {
  const segments = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of items) {
      const m = it.model || 'unknown';
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    const total = items.length || 1;
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([model, n], i) => ({
        model,
        n,
        pct: (n / total) * 100,
        ink: MODEL_INKS[Math.min(i, MODEL_INKS.length - 1)] ?? 'var(--cm-faint)',
      }));
  }, [items]);

  if (segments.length === 0) return null;

  const summary = segments.map((s) => `${s.model} ${s.n}`).join(', ');
  return (
    <span
      role="img"
      aria-label={`Models this day: ${summary}`}
      title={segments.map((s) => `${s.model} · ${s.n} (${Math.round(s.pct)}%)`).join('\n')}
      style={{
        display: 'inline-flex',
        width: 96,
        height: 6,
        borderRadius: 999,
        overflow: 'hidden',
        background: 'var(--cm-subtle)',
        border: '1px solid var(--cm-border)',
      }}
    >
      {segments.map((s, i) => (
        <span
          key={s.model + i}
          style={{
            width: `${s.pct}%`,
            background: s.ink,
            // A whisker between bands so adjacent segments stay legible.
            boxShadow: i > 0 ? 'inset 1px 0 0 var(--cm-bg)' : undefined,
          }}
        />
      ))}
    </span>
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
  onRename,
  onTagsChanged,
}: {
  item: HistoryItem;
  open: boolean;
  onToggle: () => void;
  onDelete: () => void | Promise<void>;
  onRename: (title: string) => void | Promise<void>;
  onTagsChanged: (tags: string[]) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(item.title ?? '');
  const displayTitle = item.title?.trim() || item.query;
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
          <div style={{ fontWeight: 500, fontSize: 15, lineHeight: 1.4, flex: 1, minWidth: 0 }}>
            {displayTitle}
            {item.title && item.title.trim() && item.title.trim() !== item.query ? (
              <div
                style={{
                  marginTop: 4,
                  fontWeight: 400,
                  fontSize: 12,
                  color: 'var(--cm-faint)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {item.query}
              </div>
            ) : null}
          </div>
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
          {(item.tags ?? []).map((t) => (
            <span
              key={`tag-${t}`}
              style={{
                padding: '2px 8px',
                borderRadius: 999,
                background: 'color-mix(in srgb, var(--cm-accent) 14%, transparent)',
                color: 'var(--cm-accent)',
                fontSize: 10.5,
              }}
            >
              #{t}
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
            <TagEditor
              itemId={item.id}
              tags={item.tags ?? []}
              onChanged={onTagsChanged}
            />
          </div>

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
            {editingTitle ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setEditingTitle(false);
                  await onRename(titleDraft);
                }}
                style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}
              >
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setEditingTitle(false);
                      setTitleDraft(item.title ?? '');
                    }
                  }}
                  placeholder="Custom title (empty to clear)"
                  maxLength={120}
                  aria-label="History entry title"
                  style={{
                    padding: '7px 10px',
                    background: 'var(--cm-paper)',
                    color: 'var(--cm-fg)',
                    border: '1px solid var(--cm-border)',
                    borderRadius: 8,
                    fontSize: 13,
                    fontFamily: 'var(--cm-font)',
                    minWidth: 220,
                  }}
                />
                <button
                  type="submit"
                  style={{
                    padding: '7px 12px',
                    background: 'var(--cm-fg)',
                    color: 'var(--cm-paper)',
                    borderRadius: 8,
                    fontSize: 13,
                    cursor: 'pointer',
                    border: 'none',
                    fontFamily: 'var(--cm-font)',
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingTitle(false);
                    setTitleDraft(item.title ?? '');
                  }}
                  style={{
                    padding: '7px 12px',
                    background: 'transparent',
                    color: 'var(--cm-muted)',
                    borderRadius: 8,
                    fontSize: 13,
                    cursor: 'pointer',
                    border: '1px solid var(--cm-border)',
                    fontFamily: 'var(--cm-font)',
                  }}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <button
                onClick={() => {
                  setTitleDraft(item.title ?? '');
                  setEditingTitle(true);
                }}
                aria-label="Rename this history entry"
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
                {item.title ? 'Rename' : 'Add title'}
              </button>
            )}
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

function TagEditor({
  itemId,
  tags,
  onChanged,
}: {
  itemId: string;
  tags: string[];
  onChanged: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    const t = draft.trim().toLowerCase();
    if (!t || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api.addHistoryTags(itemId, [t]);
      onChanged(res.tags);
      setDraft('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(tag: string) {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api.removeHistoryTags(itemId, [tag]);
      onChanged(res.tags);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', width: '100%' }}>
      <span
        className="cm-mono"
        style={{
          fontSize: 10.5,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--cm-faint)',
        }}
      >
        tags
      </span>
      {tags.length === 0 && (
        <span style={{ fontSize: 11, color: 'var(--cm-faint)' }}>none yet</span>
      )}
      {tags.map((t) => (
        <span
          key={t}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 4px 3px 10px',
            borderRadius: 999,
            background: 'var(--cm-subtle)',
            color: 'var(--cm-fg)',
            fontSize: 11.5,
            border: '1px solid var(--cm-border)',
          }}
        >
          #{t}
          <button
            type="button"
            aria-label={`Remove tag ${t}`}
            onClick={() => remove(t)}
            disabled={busy}
            style={{
              width: 18,
              height: 18,
              borderRadius: 999,
              border: 'none',
              background: 'transparent',
              color: 'var(--cm-muted)',
              cursor: busy ? 'not-allowed' : 'pointer',
              fontSize: 12,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </span>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="add tag"
          aria-label="Add a tag"
          maxLength={32}
          style={{
            width: 110,
            padding: '4px 8px',
            borderRadius: 6,
            border: '1px solid var(--cm-border)',
            background: 'var(--cm-paper)',
            color: 'var(--cm-fg)',
            fontFamily: 'var(--cm-font)',
            fontSize: 12,
          }}
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid var(--cm-border)',
            background: 'var(--cm-subtle)',
            color: 'var(--cm-fg)',
            fontSize: 12,
            cursor: busy || !draft.trim() ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--cm-font)',
          }}
        >
          add
        </button>
      </form>
      {err && (
        <span style={{ fontSize: 11, color: 'var(--cm-danger, #c0392b)' }}>{err}</span>
      )}
    </div>
  );
}
