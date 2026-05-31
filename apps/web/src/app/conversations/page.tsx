'use client';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, fmtRelative, type ConversationListItem } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconChat,
  IconPlus,
  IconRefresh,
  IconArchive,
  IconArrowRight,
  IconPencil,
  IconTrash,
} from '@clawmind/ui';

type Status = 'loading' | 'ok' | 'error' | 'empty';

const PAGE_SIZE = 25;

function highlight(text: string, q: string): React.ReactNode {
  const needle = q.trim();
  if (!needle) return text;
  const lower = text.toLowerCase();
  const ql = needle.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  let pos = lower.indexOf(ql, i);
  let key = 0;
  while (pos !== -1) {
    if (pos > i) out.push(text.slice(i, pos));
    out.push(
      <mark key={`m${key++}`} style={{ background: 'var(--cm-accent-soft)', color: 'inherit', padding: '0 2px', borderRadius: 3 }}>
        {text.slice(pos, pos + needle.length)}
      </mark>,
    );
    i = pos + needle.length;
    pos = lower.indexOf(ql, i);
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}

export default function ConversationsPage() {
  const [items, setItems] = useState<ConversationListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<Status>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, start] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  // Debounce the query so we don't hammer the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setOffset(0);
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  // Focus the search box with `/` like Linear/GitHub.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const reload = useCallback(async () => {
    setStatus('loading');
    setErr(null);
    try {
      const res = await api.conversationsSearch({
        q: debouncedQuery || undefined,
        archived: showArchived,
        limit: PAGE_SIZE,
        offset,
      });
      setItems(res.items);
      setTotal(res.total);
      setStatus(res.items.length === 0 ? 'empty' : 'ok');
    } catch (e) {
      setErr((e as Error).message);
      setStatus('error');
    }
  }, [showArchived, debouncedQuery, offset]);

  useEffect(() => {
    reload();
  }, [reload]);

  const pageInfo = useMemo(() => {
    if (total === 0) return null;
    const from = offset + 1;
    const to = Math.min(offset + items.length, total);
    return `${from}-${to} of ${total}`;
  }, [items.length, offset, total]);

  const hasPrev = offset > 0;
  const hasMore = offset + items.length < total;

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    start(async () => {
      try {
        const conv = await api.conversationCreate(title.trim() || undefined);
        setTitle('');
        // jump straight into the new conversation
        window.location.href = `/conversations/${conv.id}`;
      } catch (e2) {
        setErr((e2 as Error).message);
        setCreating(false);
      }
    });
  };

  const rename = (id: string, current: string) => {
    const next = window.prompt('Rename conversation', current);
    if (!next || next.trim() === current) return;
    setBusyId(id);
    start(async () => {
      try {
        await api.conversationRename(id, next.trim());
        await reload();
      } catch (e2) {
        setErr((e2 as Error).message);
      } finally {
        setBusyId(null);
      }
    });
  };

  const toggleArchive = (item: ConversationListItem) => {
    setBusyId(item.id);
    start(async () => {
      try {
        if (item.archivedAt) await api.conversationUnarchive(item.id);
        else await api.conversationArchive(item.id);
        await reload();
      } catch (e2) {
        setErr((e2 as Error).message);
      } finally {
        setBusyId(null);
      }
    });
  };

  const remove = (id: string) => {
    if (!window.confirm('Delete this conversation? This cannot be undone.')) return;
    setBusyId(id);
    start(async () => {
      try {
        await api.conversationDelete(id);
        await reload();
      } catch (e2) {
        setErr((e2 as Error).message);
      } finally {
        setBusyId(null);
      }
    });
  };

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopNav />
      <main style={{ maxWidth: 980, margin: '0 auto', padding: '28px 24px 80px' }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, letterSpacing: -0.3 }}>
              Conversations
            </h1>
            <p style={{ color: 'var(--cm-muted)', marginTop: 6, fontSize: 14 }}>
              Persistent threads with rolling history. Follow-ups are rewritten with prior context so retrieval stays on topic.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label
              style={{
                display: 'inline-flex',
                gap: 6,
                alignItems: 'center',
                fontSize: 13,
                color: 'var(--cm-muted)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Show archived
            </label>
            <button onClick={reload} style={ghostBtn} aria-label="Refresh">
              <IconRefresh /> Refresh
            </button>
          </div>
        </header>

        <div
          style={{
            marginTop: 20,
            display: 'flex',
            gap: 8,
            padding: 10,
            border: '1px solid var(--cm-border)',
            borderRadius: 12,
            alignItems: 'center',
            position: 'relative',
          }}
        >
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles and messages...   (press / to focus)"
            aria-label="Search conversations"
            style={{
              flex: 1,
              padding: '8px 10px',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--cm-fg)',
              fontSize: 14,
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              style={{ ...ghostBtn, padding: '4px 8px' }}
              aria-label="Clear search"
            >
              Clear
            </button>
          )}
          {pageInfo && (
            <span style={{ fontSize: 12, color: 'var(--cm-muted)', whiteSpace: 'nowrap' }}>
              {pageInfo}
            </span>
          )}
        </div>

        <form
          onSubmit={create}
          style={{
            marginTop: 12,
            display: 'flex',
            gap: 8,
            padding: 12,
            border: '1px solid var(--cm-border)',
            borderRadius: 12,
            background: 'var(--cm-surface, transparent)',
          }}
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New conversation title (optional)"
            style={{
              flex: 1,
              padding: '8px 10px',
              border: '1px solid var(--cm-border)',
              borderRadius: 8,
              background: 'transparent',
              color: 'var(--cm-fg)',
              fontSize: 14,
            }}
          />
          <button type="submit" disabled={creating} style={primaryBtn}>
            <IconPlus /> {creating ? 'Creating...' : 'New conversation'}
          </button>
        </form>

        {status === 'loading' && (
          <div
            style={{
              marginTop: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--cm-muted)',
            }}
          >
            <Spinner /> <span style={{ marginLeft: 8 }}>Loading conversations...</span>
          </div>
        )}

        {status === 'error' && (
          <div style={{ marginTop: 24 }}>
            <ErrorState
              title="Could not load conversations"
              message={err ?? 'Unknown error'}
              onRetry={reload}
            />
          </div>
        )}

        {status === 'empty' && (
          <div style={{ marginTop: 24 }}>
            <EmptyState
              icon={<IconChat />}
              title={
                debouncedQuery
                  ? `No matches for "${debouncedQuery}"`
                  : showArchived
                    ? 'No archived conversations'
                    : 'No conversations yet'
              }
              body={
                debouncedQuery
                  ? 'Try a different word, clear the search, or toggle archived threads.'
                  : showArchived
                    ? 'Conversations you archive will show up here.'
                    : 'Start a new thread above, or ask a one-shot question from the chat page.'
              }
            />
          </div>
        )}

        {status === 'ok' && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '24px 0 0', display: 'grid', gap: 10 }}>
            {items.map((c) => {
              const busy = busyId === c.id;
              return (
                <li
                  key={c.id}
                  style={{
                    padding: 14,
                    border: '1px solid var(--cm-border)',
                    borderRadius: 12,
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      gap: 12,
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Link
                        href={`/conversations/${c.id}`}
                        style={{
                          fontWeight: 600,
                          fontSize: 15,
                          color: 'var(--cm-fg)',
                          textDecoration: 'none',
                        }}
                      >
                        {highlight(c.title || 'Untitled', debouncedQuery)}
                      </Link>
                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--cm-muted)' }}>
                        {c.turns} turns · updated {fmtRelative(c.updatedAt)}
                        {c.archivedAt ? ` · archived ${fmtRelative(c.archivedAt)}` : ''}
                      </div>
                      {c.snippet && (
                        <div
                          style={{
                            marginTop: 6,
                            fontSize: 13,
                            color: 'var(--cm-fg)',
                            opacity: 0.85,
                            lineHeight: 1.4,
                          }}
                        >
                          {highlight(c.snippet, debouncedQuery)}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => rename(c.id, c.title || '')}
                        disabled={busy}
                        style={iconBtn}
                        aria-label="Rename"
                        title="Rename"
                      >
                        <IconPencil />
                      </button>
                      <button
                        onClick={() => toggleArchive(c)}
                        disabled={busy}
                        style={iconBtn}
                        aria-label={c.archivedAt ? 'Unarchive' : 'Archive'}
                        title={c.archivedAt ? 'Unarchive' : 'Archive'}
                      >
                        <IconArchive />
                      </button>
                      <button
                        onClick={() => remove(c.id)}
                        disabled={busy}
                        style={{ ...iconBtn, color: 'var(--cm-danger, #c0392b)' }}
                        aria-label="Delete"
                        title="Delete"
                      >
                        <IconTrash />
                      </button>
                      <Link href={`/conversations/${c.id}`} style={primaryBtn}>
                        Open <IconArrowRight />
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {status === 'ok' && (hasPrev || hasMore) && (
          <div
            style={{
              marginTop: 16,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={!hasPrev}
              style={{ ...ghostBtn, opacity: hasPrev ? 1 : 0.5 }}
            >
              ← Previous
            </button>
            <span style={{ fontSize: 12, color: 'var(--cm-muted)' }}>{pageInfo}</span>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={!hasMore}
              style={{ ...ghostBtn, opacity: hasMore ? 1 : 0.5 }}
            >
              Next →
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid var(--cm-border)',
  background: 'var(--cm-accent-soft)',
  color: 'var(--cm-fg)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  textDecoration: 'none',
};

const ghostBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid var(--cm-border)',
  background: 'transparent',
  color: 'var(--cm-fg)',
  fontSize: 13,
  cursor: 'pointer',
};

const iconBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 8,
  borderRadius: 8,
  border: '1px solid var(--cm-border)',
  background: 'transparent',
  color: 'var(--cm-fg)',
  cursor: 'pointer',
};
