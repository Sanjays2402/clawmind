'use client';
import { use, useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, fmtRelative, type Conversation, type Source } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconChat,
  IconSend,
  IconDownload,
  IconArchive,
  IconArrowRight,
} from '@clawmind/ui';

type Status = 'loading' | 'ok' | 'error';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ConversationDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sending, setSending] = useState(false);
  const [rewritten, setRewritten] = useState<string | null>(null);
  const [, start] = useTransition();
  const endRef = useRef<HTMLDivElement | null>(null);

  const reload = useCallback(async () => {
    setStatus('loading');
    setErr(null);
    try {
      const c = await api.conversationGet(id);
      setConv(c);
      setStatus('ok');
    } catch (e) {
      setErr((e as Error).message);
      setStatus('error');
    }
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conv?.turns.length]);

  const ask = (e: React.FormEvent) => {
    e.preventDefault();
    const text = q.trim();
    if (!text || sending) return;
    setSending(true);
    setRewritten(null);
    start(async () => {
      try {
        const r = await api.conversationAsk(id, text, 6);
        if (r.rewrittenQuery && r.rewrittenQuery !== text) setRewritten(r.rewrittenQuery);
        setQ('');
        await reload();
      } catch (e2) {
        setErr((e2 as Error).message);
      } finally {
        setSending(false);
      }
    });
  };

  const archive = () => {
    if (!conv) return;
    if (!window.confirm('Archive this conversation? It will be hidden from the default list.')) return;
    start(async () => {
      try {
        await api.conversationArchive(conv.id);
        window.location.href = '/conversations';
      } catch (e2) {
        setErr((e2 as Error).message);
      }
    });
  };

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopNav />
      <main style={{ maxWidth: 880, margin: '0 auto', padding: '24px 20px 120px' }}>
        <div style={{ marginBottom: 12, fontSize: 13 }}>
          <Link href="/conversations" style={{ color: 'var(--cm-muted)', textDecoration: 'none' }}>
            ← All conversations
          </Link>
        </div>

        {status === 'loading' && (
          <div
            style={{
              marginTop: 60,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--cm-muted)',
            }}
          >
            <Spinner /> <span style={{ marginLeft: 8 }}>Loading conversation...</span>
          </div>
        )}

        {status === 'error' && (
          <div style={{ marginTop: 24 }}>
            <ErrorState
              title="Could not load conversation"
              message={err ?? 'Unknown error'}
              onRetry={reload}
            />
          </div>
        )}

        {status === 'ok' && conv && (
          <>
            <header
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
                alignItems: 'flex-end',
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: -0.3 }}>
                  {conv.title || 'Untitled conversation'}
                </h1>
                <p style={{ marginTop: 4, fontSize: 12, color: 'var(--cm-muted)' }}>
                  {conv.turns.length} turns · updated {fmtRelative(conv.updatedAt)}
                  {conv.archivedAt ? ` · archived` : ''}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <a
                  href={api.conversationExportUrl(conv.id)}
                  style={ghostBtn}
                  download
                >
                  <IconDownload /> Export .md
                </a>
                {!conv.archivedAt && (
                  <button onClick={archive} style={ghostBtn} aria-label="Archive">
                    <IconArchive /> Archive
                  </button>
                )}
              </div>
            </header>

            {conv.turns.length === 0 ? (
              <div style={{ marginTop: 32 }}>
                <EmptyState
                  icon={<IconChat />}
                  title="No turns yet"
                  body="Ask your first question below. Follow-ups will reuse this thread's history."
                />
              </div>
            ) : (
              <ol
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: '24px 0 0',
                  display: 'grid',
                  gap: 16,
                }}
              >
                {conv.turns.map((t, i) => (
                  <li
                    key={t.id ?? i}
                    style={{
                      padding: 14,
                      border: '1px solid var(--cm-border)',
                      borderRadius: 12,
                      background:
                        t.role === 'user' ? 'transparent' : 'var(--cm-accent-soft, transparent)',
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                        color: 'var(--cm-muted)',
                        marginBottom: 6,
                      }}
                    >
                      {t.role} {t.ts ? `· ${fmtRelative(t.ts)}` : ''}
                      {t.model ? ` · ${t.model}` : ''}
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.55 }}>
                      {t.content}
                    </div>
                    {t.sources && t.sources.length > 0 && (
                      <details style={{ marginTop: 10 }}>
                        <summary
                          style={{
                            cursor: 'pointer',
                            fontSize: 12,
                            color: 'var(--cm-muted)',
                          }}
                        >
                          {t.sources.length} source{t.sources.length === 1 ? '' : 's'}
                        </summary>
                        <ul
                          style={{
                            listStyle: 'none',
                            padding: 0,
                            margin: '8px 0 0',
                            display: 'grid',
                            gap: 6,
                          }}
                        >
                          {t.sources.map((s: Source, j: number) => (
                            <li key={j} style={{ fontSize: 12 }}>
                              <Link
                                href={{
                                  pathname: '/sources/view',
                                  query: { path: s.path, start: s.startLine, end: s.endLine },
                                }}
                                style={{ color: 'var(--cm-fg)', textDecoration: 'none' }}
                              >
                                <span style={{ color: 'var(--cm-muted)' }}>
                                  {s.displayPath || s.path}
                                </span>{' '}
                                <span style={{ color: 'var(--cm-muted)' }}>
                                  L{s.startLine}–L{s.endLine}
                                </span>{' '}
                                <IconArrowRight size={12} />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
            )}

            <div ref={endRef} />

            {rewritten && (
              <div
                style={{
                  marginTop: 12,
                  fontSize: 12,
                  color: 'var(--cm-muted)',
                  padding: '8px 10px',
                  border: '1px dashed var(--cm-border)',
                  borderRadius: 8,
                }}
              >
                Rewrote follow-up to: <span style={{ color: 'var(--cm-fg)' }}>{rewritten}</span>
              </div>
            )}

            <form
              onSubmit={ask}
              style={{
                marginTop: 16,
                display: 'flex',
                gap: 8,
                position: 'sticky',
                bottom: 12,
                padding: 10,
                border: '1px solid var(--cm-border)',
                borderRadius: 12,
                background: 'var(--cm-bg)',
                backdropFilter: 'blur(6px)',
              }}
            >
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Ask a follow-up..."
                disabled={sending || !!conv.archivedAt}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  border: '1px solid var(--cm-border)',
                  borderRadius: 8,
                  background: 'transparent',
                  color: 'var(--cm-fg)',
                  fontSize: 14,
                }}
              />
              <button
                type="submit"
                disabled={sending || !q.trim() || !!conv.archivedAt}
                style={primaryBtn}
              >
                <IconSend /> {sending ? 'Asking...' : 'Send'}
              </button>
            </form>

            {conv.archivedAt && (
              <p style={{ marginTop: 8, fontSize: 12, color: 'var(--cm-muted)' }}>
                This conversation is archived. Unarchive it from the list to continue.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '10px 14px',
  borderRadius: 8,
  border: '1px solid var(--cm-border)',
  background: 'var(--cm-accent-soft)',
  color: 'var(--cm-fg)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
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
  textDecoration: 'none',
};
