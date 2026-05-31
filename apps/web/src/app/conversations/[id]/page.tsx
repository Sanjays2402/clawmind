'use client';
import { use, useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, fmtRelative, type Conversation, type ConversationTurn, type Source } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  NamespacePicker,
  Spinner,
  IconChat,
  IconSend,
  IconDownload,
  IconArchive,
  IconArrowRight,
  type Ns,
} from '@clawmind/ui';

type Status = 'loading' | 'ok' | 'error';

interface PageProps {
  params: Promise<{ id: string }>;
}

// Live, streaming follow-ups against a saved conversation. Tokens render as
// they arrive from the server; the rewrite hint and source list appear as
// soon as the API emits them; the user turn is added optimistically so the
// thread never feels stalled while the model is generating.
export default function ConversationDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [namespaces, setNamespaces] = useState<Ns[]>(['memory', 'projects', 'sessions']);
  const [sending, setSending] = useState(false);
  const [rewritten, setRewritten] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [streamText, setStreamText] = useState('');
  const [streamSources, setStreamSources] = useState<Source[]>([]);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [firstTokenMs, setFirstTokenMs] = useState<number | null>(null);
  const [, start] = useTransition();
  const endRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef(false);

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
  }, [conv?.turns.length, streamText, pendingUser]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const text = q.trim();
    if (!text || sending) return;
    setSending(true);
    setErr(null);
    setRewritten(null);
    setPendingUser(text);
    setStreamText('');
    setStreamSources([]);
    setLatencyMs(null);
    setFirstTokenMs(null);
    cancelRef.current = false;
    setQ('');
    const startedAt = performance.now();
    let gotFirst = false;
    try {
      await api.conversationAskStream(id, { q: text, k: 6, namespaces }, (evt) => {
        if (cancelRef.current) return;
        if (evt.type === 'rewrite') {
          const v = evt.value as { rewritten?: string };
          if (v?.rewritten) setRewritten(v.rewritten);
        } else if (evt.type === 'sources') {
          setStreamSources(evt.value as Source[]);
        } else if (evt.type === 'token') {
          if (!gotFirst) {
            gotFirst = true;
            setFirstTokenMs(Math.round(performance.now() - startedAt));
          }
          setStreamText((s) => s + (evt.value as string));
        } else if (evt.type === 'error') {
          const v = evt.value as { message?: string };
          setErr(v?.message ?? 'stream error');
        }
      });
      setLatencyMs(Math.round(performance.now() - startedAt));
      // Pull the canonical persisted turns so ids, timestamps, model name match.
      await reload();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setSending(false);
      setPendingUser(null);
      setStreamText('');
      setStreamSources([]);
    }
  }

  function stop() {
    cancelRef.current = true;
    setSending(false);
  }

  function archive() {
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
  }

  return (
    <div className="min-h-screen bg-cm-bg">
      <TopNav />
      <main className="mx-auto w-full max-w-[920px] px-5 pb-32 pt-6 sm:px-8">
        <div className="mb-3 text-[13px]">
          <Link href="/conversations" className="text-cm-muted no-underline hover:text-cm-fg">
            ← All conversations
          </Link>
        </div>

        {status === 'loading' && (
          <div className="mt-16 flex items-center justify-center gap-2 text-cm-muted">
            <Spinner /> <span>Loading conversation</span>
          </div>
        )}

        {status === 'error' && (
          <div className="mt-6">
            <ErrorState title="Could not load conversation" message={err ?? 'Unknown error'} onRetry={reload} />
          </div>
        )}

        {status === 'ok' && conv && (
          <>
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h1 className="m-0 truncate text-[22px] font-semibold tracking-[-0.3px] text-cm-fg">
                  {conv.title || 'Untitled conversation'}
                </h1>
                <p className="mt-1 text-[12px] text-cm-muted">
                  {conv.turns.length} {conv.turns.length === 1 ? 'turn' : 'turns'} · updated {fmtRelative(conv.updatedAt)}
                  {conv.archivedAt ? ' · archived' : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={api.conversationExportUrl(conv.id)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-cm-border bg-transparent px-3 py-2 text-[13px] text-cm-fg no-underline hover:bg-cm-paper"
                  download
                  title="Download as Markdown"
                >
                  <IconDownload /> .md
                </a>
                <a
                  href={api.conversationExportJsonUrl(conv.id)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-cm-border bg-transparent px-3 py-2 text-[13px] text-cm-fg no-underline hover:bg-cm-paper"
                  download
                  title="Download as JSON"
                >
                  <IconDownload /> .json
                </a>
                <a
                  href={api.conversationExportCsvUrl(conv.id)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-cm-border bg-transparent px-3 py-2 text-[13px] text-cm-fg no-underline hover:bg-cm-paper"
                  download
                  title="Download as CSV"
                >
                  <IconDownload /> .csv
                </a>
                {!conv.archivedAt && (
                  <button
                    onClick={archive}
                    aria-label="Archive"
                    className="inline-flex items-center gap-1.5 rounded-md border border-cm-border bg-transparent px-3 py-2 text-[13px] text-cm-fg hover:bg-cm-paper"
                  >
                    <IconArchive /> Archive
                  </button>
                )}
              </div>
            </header>

            <div className="mt-4 border-y border-cm-border py-3">
              <NamespacePicker value={namespaces} onChange={setNamespaces} variant="breadcrumb" />
            </div>

            {conv.turns.length === 0 && !pendingUser ? (
              <div className="mt-10">
                <EmptyState
                  icon={<IconChat />}
                  title="No turns yet"
                  body="Ask your first question below. Follow-ups will reuse this thread's history so you can keep digging."
                />
              </div>
            ) : (
              <ol className="m-0 mt-6 grid list-none gap-4 p-0">
                {conv.turns.map((t, i) => (
                  <TurnCard key={t.id ?? i} turn={t} />
                ))}
                {pendingUser && (
                  <TurnCard
                    turn={{ role: 'user', content: pendingUser, ts: Date.now() }}
                    pending
                  />
                )}
                {sending && (
                  <TurnCard
                    turn={{
                      role: 'assistant',
                      content: streamText,
                      ts: Date.now(),
                      sources: streamSources,
                    }}
                    streaming
                    firstTokenMs={firstTokenMs}
                  />
                )}
              </ol>
            )}

            <div ref={endRef} />

            {rewritten && (
              <div className="mt-3 rounded-md border border-dashed border-cm-border px-3 py-2 text-[12px] text-cm-muted">
                Rewrote follow-up to: <span className="text-cm-fg">{rewritten}</span>
              </div>
            )}

            {!sending && latencyMs !== null && (
              <div className="cm-mono mt-2 text-[11px] text-cm-faint">
                done in {latencyMs}ms{firstTokenMs !== null ? ` · first token ${firstTokenMs}ms` : ''}
              </div>
            )}

            <form
              onSubmit={ask}
              className="sticky bottom-3 mt-4 flex gap-2 rounded-xl border border-cm-border bg-cm-bg/80 p-2.5 backdrop-blur"
            >
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={
                  conv.turns.length === 0
                    ? 'Ask something about your workspace...'
                    : 'Ask a follow-up...'
                }
                disabled={sending || !!conv.archivedAt}
                aria-label="Ask a follow-up"
                className="flex-1 rounded-md border border-cm-border bg-transparent px-3 py-2.5 text-[14px] text-cm-fg outline-none placeholder:text-cm-faint focus:border-cm-fg-soft disabled:opacity-50"
              />
              {sending ? (
                <button
                  type="button"
                  onClick={stop}
                  className="inline-flex items-center gap-1.5 rounded-md border border-cm-border bg-transparent px-3.5 py-2.5 text-[13px] text-cm-fg hover:bg-cm-paper"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!q.trim() || !!conv.archivedAt}
                  className="inline-flex items-center gap-1.5 rounded-md border border-cm-border bg-cm-accent-soft px-3.5 py-2.5 text-[13px] font-medium text-cm-fg hover:opacity-90 disabled:opacity-40"
                >
                  <IconSend /> Send
                </button>
              )}
            </form>

            {conv.archivedAt && (
              <p className="mt-2 text-[12px] text-cm-muted">
                This conversation is archived. Unarchive it from the list to continue.
              </p>
            )}

            {err && !sending && (
              <p className="mt-2 text-[12px] text-cm-danger">{err}</p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function TurnCard({
  turn,
  pending,
  streaming,
  firstTokenMs,
}: {
  turn: ConversationTurn;
  pending?: boolean;
  streaming?: boolean;
  firstTokenMs?: number | null;
}) {
  const isUser = turn.role === 'user';
  return (
    <li
      className={[
        'rounded-xl border p-3.5',
        isUser ? 'border-cm-border bg-transparent' : 'border-cm-border bg-cm-paper',
        pending ? 'opacity-60' : '',
      ].join(' ')}
    >
      <div className="cm-mono mb-1.5 text-[11px] uppercase tracking-wider text-cm-muted">
        {turn.role}
        {turn.ts ? ` · ${fmtRelative(turn.ts)}` : ''}
        {turn.model ? ` · ${turn.model}` : ''}
        {streaming ? ' · streaming' : ''}
        {streaming && firstTokenMs !== null && firstTokenMs !== undefined ? ` · first token ${firstTokenMs}ms` : ''}
      </div>
      <div className="whitespace-pre-wrap text-[14px] leading-[1.6] text-cm-fg">
        {turn.content}
        {streaming && (
          <span
            aria-hidden="true"
            className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-cm-fg-soft align-middle"
          />
        )}
      </div>
      {turn.sources && turn.sources.length > 0 && (
        <details className="mt-2.5" open={!!streaming}>
          <summary className="cursor-pointer text-[12px] text-cm-muted">
            {turn.sources.length} {turn.sources.length === 1 ? 'source' : 'sources'}
          </summary>
          <ul className="m-0 mt-2 grid list-none gap-1.5 p-0">
            {turn.sources.map((s: Source, j: number) => (
              <li key={j} className="text-[12px]">
                <Link
                  href={{
                    pathname: '/sources/view',
                    query: { path: s.path, start: s.startLine, end: s.endLine },
                  }}
                  className="inline-flex items-center gap-1 text-cm-fg no-underline hover:text-cm-accent"
                >
                  <span className="text-cm-muted">{s.displayPath || s.path}</span>
                  <span className="text-cm-muted">
                    L{s.startLine}–L{s.endLine}
                  </span>
                  <IconArrowRight size={12} />
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
