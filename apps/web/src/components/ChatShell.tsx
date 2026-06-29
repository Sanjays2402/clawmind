'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { TopNav } from '@/components/TopNav';
import { NamespacePicker, type Ns, ChatAnswerSkeleton, SourcesRailSkeleton, IconArrowRight } from '@clawmind/ui';
import { ChatStream } from './ChatStream';
import { SourcesPane } from './SourcesPane';
import { Composer } from './Composer';
import { ShareAnswerButton } from './ShareAnswerButton';
import { CopyAnswerButton } from './CopyAnswerButton';
import { ChatError } from './ChatError';
import { StreamProgress } from './StreamProgress';
import { JumpToLatest } from './JumpToLatest';
import { ThreadOutline } from './ThreadOutline';
import { api } from '@/lib/api';
import { revealSourceCard } from '@/lib/sourceNav';
import { citedOrder, citePillId } from '@/lib/citations';
import { readNsPref, writeNsPref } from '@/lib/nsPref';

interface Source {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  score: number;
  snippet?: { text: string; spans: { start: number; end: number }[] } | null;
  displayPath?: string;
}

// A single question/answer exchange in the running thread. The chat used to
// hold ONE answer and wipe it on every new question, so the conversation was
// amnesiac — ask a follow-up and the prior Q/A vanished. A thread is now an
// ordered list of these, so the whole exchange stays on screen and scrollable.
interface Turn {
  id: string;
  question: string;
  answer: string;
  sources: Source[];
  error: string | null;
  done: boolean;
  // Captured when the stream finishes so the badge persists after streaming:
  // total tokens received and wall-clock from first to last token.
  tokens?: number;
  elapsedMs?: number;
}

function makeTurnId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    try {
      return crypto.randomUUID();
    } catch {
      /* fall through */
    }
  }
  return 'turn-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// Stable DOM id for a turn's article, so the thread outline can scroll an
// exchange into view by id.
function turnAnchorId(id: string): string {
  return 'cm-turn-' + id;
}

// Compact wall-clock for the finished-answer badge: sub-second in ms, then
// seconds with one decimal.
function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Tokens-per-second over the streaming window, rounded; blank for zero time.
function formatRate(tokens: number, ms: number): string {
  if (ms <= 0) return '';
  return `${Math.round((tokens / ms) * 1000)} tok/s`;
}

export function ChatShell({
  threadId: _t,
  onThread: _o,
}: {
  threadId: string | null;
  onThread: (id: string | null) => void;
}) {
  const [question, setQuestion] = useState('');
  // The thread, newest-first. The composer lives at the TOP of the page
  // (Reflect/Mem style), so the just-asked turn renders directly beneath it —
  // exactly where the old single answer used to sit — and you scroll DOWN into
  // older turns. (A bottom-anchored composer would put newest at the bottom;
  // ours is top-anchored, so newest-on-top is the consistent reading flow.)
  const [turns, setTurns] = useState<Turn[]>([]);
  // Which turn the source rail + citation keyboard cycle currently track. The
  // single sticky rail shows ONE turn's sources at a time (stacking every
  // turn's rail would bloat the margin and break per-turn citation numbers);
  // streaming a new turn — or clicking a citation in an older one — makes that
  // turn active.
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<Source | null>(null);
  const [loading, setLoading] = useState(false);
  const [namespaces, setNamespaces] = useState<Ns[]>(['memory', 'projects', 'sessions']);
  const [composerFocus, setComposerFocus] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const [lastTokenMs, setLastTokenMs] = useState<number | null>(null);
  const lastTokenAtRef = useRef<number | null>(null);
  const cancelRef = useRef<boolean>(false);
  const searchParams = useSearchParams();
  const prefillRef = useRef<string | null>(null);

  const activeTurn = turns.find((t) => t.id === activeTurnId) ?? null;

  useEffect(() => {
    const initial = searchParams.get('q');
    if (!initial || prefillRef.current === initial) return;
    prefillRef.current = initial;
    setQuestion(initial);
  }, [searchParams]);

  // Restore the reader's last namespace selection on mount. Done in an effect
  // (not the useState initialiser) so the server-rendered default and the
  // first client render agree — no hydration mismatch — then the saved subset
  // is applied. A null result (no saved pref) leaves the default in place.
  useEffect(() => {
    const saved = readNsPref();
    if (saved) setNamespaces(saved);
  }, []);

  // Wrap setNamespaces so every toggle in the breadcrumb picker persists the
  // new selection. Kept out of the picker's render path so the component stays
  // a pure controlled input.
  const onNamespacesChange = useCallback((next: Ns[]) => {
    setNamespaces(next);
    writeNsPref(next);
  }, []);

  // `[` / `]` cycle through the citations in the ACTIVE turn's answer, in the
  // order they first appear. Each step focuses the matching pill, marks its
  // source active, and reveals the rail card (scroll + flash). The cycle only
  // contains sources that are actually cited. Suppressed while the user is
  // typing in the composer or a rail filter.
  useEffect(() => {
    const turn = turns.find((t) => t.id === activeTurnId);
    if (!turn || !turn.answer) return;
    const answer = turn.answer;
    const turnSources = turn.sources;
    function onKey(e: KeyboardEvent) {
      if (e.key !== '[' && e.key !== ']') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      const cited = citedOrder(answer, turnSources);
      if (cited.length === 0) return;
      e.preventDefault();
      const curIdx = activeSource ? cited.findIndex((s) => s.id === activeSource.id) : -1;
      const delta = e.key === ']' ? 1 : -1;
      // From "no selection", `]` lands on the first and `[` on the last.
      const nextIdx =
        curIdx === -1
          ? (delta === 1 ? 0 : cited.length - 1)
          : (curIdx + delta + cited.length) % cited.length;
      const next = cited[nextIdx];
      if (!next) return;
      setActiveSource(next);
      revealSourceCard(next.id);
      const pill = document.getElementById(citePillId(next.id));
      if (pill) pill.focus({ preventScroll: true });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turns, activeTurnId, activeSource]);

  // `/` focuses the composer from anywhere on the chat page, mirroring the
  // rail's j/k muscle memory. Suppressed while typing in any input/textarea
  // (so a literal slash in the composer or a filter is never stolen) and when
  // a modifier is held (cmd+/ is the saved-prompt picker). preventDefault
  // stops the slash from also landing as the first character once focused.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      e.preventDefault();
      setComposerFocus((n) => n + 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Stream a question into a specific turn. Shared by a fresh submit and an
  // in-place retry, so both paths write tokens/sources/errors into the same
  // turn shape. Resets the target turn's body first (a retry re-streams a
  // failed turn cleanly) and makes that turn active so the rail follows it.
  const runStream = useCallback(
    async (turnId: string, q: string) => {
      setLoading(true);
      setActiveTurnId(turnId);
      setActiveSource(null);
      setTokenCount(0);
      setLastTokenMs(null);
      lastTokenAtRef.current = null;
      cancelRef.current = false;
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId ? { ...t, answer: '', sources: [], error: null, done: false, tokens: undefined, elapsedMs: undefined } : t,
        ),
      );
      // First-token wall-clock anchor + a local count, so the finished badge
      // can report total tokens and end-to-end stream time independent of the
      // live counter state (which resets between turns).
      let firstTokenAt: number | null = null;
      let localTokens = 0;
      try {
        await api.stream({ q, namespaces }, (evt) => {
          if (cancelRef.current) return;
          if (evt.type === 'sources') {
            const srcs = evt.value as Source[];
            setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, sources: srcs } : t)));
          }
          if (evt.type === 'token') {
            const now = Date.now();
            if (firstTokenAt === null) firstTokenAt = now;
            localTokens += 1;
            const prev = lastTokenAtRef.current;
            if (prev !== null) setLastTokenMs(now - prev);
            lastTokenAtRef.current = now;
            setTokenCount((c) => c + 1);
            const tok = evt.value as string;
            setTurns((cur) => cur.map((t) => (t.id === turnId ? { ...t, answer: t.answer + tok } : t)));
          }
          if (evt.type === 'error') {
            const msg = (evt.value as { message: string }).message;
            setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, error: msg } : t)));
          }
        });
      } catch (err) {
        const msg = (err as Error).message;
        setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, error: msg } : t)));
      } finally {
        setLoading(false);
        const elapsed = firstTokenAt !== null ? Date.now() - firstTokenAt : undefined;
        setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, done: true, tokens: localTokens, elapsedMs: elapsed } : t)));
      }
    },
    [namespaces],
  );

  async function submit(q: string = question) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    const id = makeTurnId();
    const turn: Turn = { id, question: trimmed, answer: '', sources: [], error: null, done: false };
    // Prepend so the newest exchange sits directly under the composer.
    setTurns((prev) => [turn, ...prev]);
    // Clear the composer for the follow-up — the question is preserved in the
    // turn header now, so the field doesn't need to keep holding it.
    setQuestion('');
    await runStream(id, trimmed);
  }

  // Re-run a turn's question in place (from its error panel).
  function retryTurn(id: string) {
    if (loading) return;
    const turn = turns.find((t) => t.id === id);
    if (!turn) return;
    void runStream(id, turn.question);
  }

  // Drop a turn's question back into the composer so the reader can tweak it
  // and ask again (which starts a fresh turn). Clears nothing on the existing
  // turn — editing is non-destructive.
  function editTurn(q: string) {
    setQuestion(q);
    setComposerFocus((n) => n + 1);
  }

  // Start a clean thread: clears the running exchange and returns focus to the
  // composer. The prior thread is gone from the surface (history still keeps
  // each answer server-side), giving a deliberate "new conversation" reset.
  function newThread() {
    if (loading) return;
    setTurns([]);
    setActiveTurnId(null);
    setActiveSource(null);
    setQuestion('');
    setComposerFocus((n) => n + 1);
  }

  // Jump to an exchange from the thread outline: make it the active turn (so
  // the margin rail follows it) and scroll its block into view. Reduced-motion
  // users get an instant jump.
  function jumpToTurn(id: string) {
    setActiveTurnId(id);
    setActiveSource(null);
    if (typeof document === 'undefined') return;
    const el = document.getElementById(turnAnchorId(id));
    if (!el) return;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }

  // Clicking a starter prompt in the empty state drops it into the composer
  // and returns focus there (caret at end via focusSignal) so the reader can
  // tweak or submit immediately.
  function pickStarter(prompt: string) {
    setQuestion(prompt);
    setComposerFocus((n) => n + 1);
  }

  const hasThread = turns.length > 0;
  const streamingId = loading ? activeTurnId : null;

  return (
    <main className="min-h-screen flex flex-col bg-cm-bg">
      <TopNav />

      {/* Breadcrumb namespace header */}
      <div className="border-b border-cm-border">
        <div className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-4 px-6 py-3 sm:px-10">
          <NamespacePicker value={namespaces} onChange={onNamespacesChange} variant="breadcrumb" />
          <span className="cm-mono text-[11px] text-cm-faint">
            cmd + enter to ask &middot; / to focus &middot; cmd + / saved &middot; [ ] cited &middot; j k rail
          </span>
        </div>
      </div>

      {/* Two-column reading layout: wide answer column, narrow source rail */}
      <div className="mx-auto grid w-full max-w-[1180px] flex-1 grid-cols-1 gap-10 px-6 pb-24 pt-8 sm:px-10 lg:grid-cols-[minmax(0,720px)_minmax(260px,320px)]">
        <section className="min-w-0">
          {/* Composer sits at the TOP, Reflect/Mem style */}
          <Composer
            value={question}
            onChange={setQuestion}
            onSubmit={submit}
            loading={loading}
            onStop={() => { cancelRef.current = true; setLoading(false); }}
            focusSignal={composerFocus}
          />

          {/* Thread meta strip: turn count + a deliberate "new thread" reset.
              Only present once an exchange exists. */}
          {hasThread && (
            <div className="mt-4 flex items-center justify-between">
              <span className="cm-mono text-[11px] uppercase tracking-[0.12em] text-cm-faint">
                {turns.length} {turns.length === 1 ? 'exchange' : 'exchanges'} in this thread
              </span>
              <button
                type="button"
                onClick={newThread}
                disabled={loading}
                className="cm-mono inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2.5 py-1 text-[11px] text-cm-fg-soft transition-colors hover:bg-cm-accent-soft hover:text-cm-fg disabled:cursor-not-allowed disabled:opacity-50"
              >
                New thread
              </button>
            </div>
          )}

          <div className="mt-8">
            {!hasThread && !loading && (
              <EmptyReading onPick={pickStarter} />
            )}

            {hasThread && (
              <div className="flex flex-col">
                {turns.map((turn, i) => (
                  <TurnBlock
                    key={turn.id}
                    anchorId={turnAnchorId(turn.id)}
                    turn={turn}
                    separated={i > 0}
                    isActive={turn.id === activeTurnId}
                    activeSourceId={turn.id === activeTurnId ? activeSource?.id ?? null : null}
                    streaming={turn.id === streamingId}
                    tokenCount={tokenCount}
                    lastTokenMs={lastTokenMs}
                    onCite={(s) => {
                      setActiveTurnId(turn.id);
                      setActiveSource(s);
                    }}
                    onFocusTurn={() => {
                      setActiveTurnId(turn.id);
                      setActiveSource(null);
                    }}
                    onRetry={() => retryTurn(turn.id)}
                    onEdit={() => editTurn(turn.question)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          {loading && activeTurn && activeTurn.sources.length === 0 ? (
            <SourcesRailSkeleton />
          ) : (
            <SourcesPane
              sources={activeTurn?.sources ?? []}
              active={activeSource}
              onSelect={setActiveSource}
            />
          )}
        </aside>
      </div>

      {/* Floating "jump to latest" while the active answer streams and the
          reader has scrolled above the live token edge. */}
      <JumpToLatest active={loading && (activeTurn?.answer ?? '') !== ''} />

      {/* Floating thread outline: an index of the exchanges in this thread.
          Hidden for a single-exchange thread. */}
      <ThreadOutline
        turns={turns.map((t) => ({ id: t.id, question: t.question, sourceCount: t.sources.length }))}
        activeId={activeTurnId}
        onJump={jumpToTurn}
      />
    </main>
  );
}

// One question/answer exchange. Renders the question as a quiet header (so the
// reader always sees what was asked — it used to live only in the composer and
// vanish on submit), then the streamed answer with its citation rail wiring,
// per-turn copy/share, and a per-turn error panel. Clicking anywhere in a
// turn's answer column makes it the active turn so the margin rail follows it.
function TurnBlock({
  turn,
  anchorId,
  separated,
  isActive,
  activeSourceId,
  streaming,
  tokenCount,
  lastTokenMs,
  onCite,
  onFocusTurn,
  onRetry,
  onEdit,
}: {
  turn: Turn;
  anchorId: string;
  separated: boolean;
  isActive: boolean;
  activeSourceId: string | null;
  streaming: boolean;
  tokenCount: number;
  lastTokenMs: number | null;
  onCite: (s: Source) => void;
  onFocusTurn: () => void;
  onRetry: () => void;
  onEdit: () => void;
}) {
  const showSkeleton = streaming && turn.answer === '' && !turn.error;
  return (
    <article
      id={anchorId}
      className={separated ? 'mt-10 border-t border-cm-border pt-10' : ''}
      style={{ scrollMarginTop: 96 }}
      onMouseDown={onFocusTurn}
    >
      <QuestionHeader text={turn.question} active={isActive} />

      <div className="mt-4">
        {showSkeleton && <ChatAnswerSkeleton />}

        {turn.error && turn.answer === '' && (
          <ChatError message={turn.error} onRetry={onRetry} onEdit={onEdit} />
        )}

        {turn.answer && (
          <>
            <ChatStream
              text={turn.answer}
              sources={turn.sources}
              activeId={activeSourceId}
              onCite={onCite}
            />
            {streaming && <StreamProgress tokens={tokenCount} lastMs={lastTokenMs} />}
            {/* Sentinel parked at the live token edge of the streaming turn.
                JumpToLatest observes it to know when the reader has scrolled
                above the streaming text. */}
            {streaming && <div id="cm-stream-end" aria-hidden="true" />}

            {/* A turn that errored mid-stream keeps its partial answer and adds
                a compact inline retry line rather than discarding the text. */}
            {turn.error && (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-cm-border bg-cm-cite-bg px-3 py-2 text-[13px] text-cm-fg-soft">
                <span>The answer stopped early: {turn.error}</span>
                <button
                  type="button"
                  onClick={onRetry}
                  className="cm-mono rounded border border-cm-border px-2 py-0.5 text-[11px] text-cm-fg-soft hover:bg-cm-accent-soft hover:text-cm-fg"
                >
                  Retry
                </button>
              </div>
            )}

            {turn.done && !turn.error && (
              <div className="mt-6 flex items-center justify-end gap-2 border-t border-cm-border pt-4">
                {turn.tokens != null && turn.tokens > 0 && (
                  <span
                    className="cm-mono mr-auto text-[11px] text-cm-faint"
                    title="Tokens streamed and total stream time for this answer"
                  >
                    {turn.tokens.toLocaleString()} tok
                    {turn.elapsedMs != null && turn.elapsedMs > 0
                      ? ` \u00b7 ${formatElapsed(turn.elapsedMs)} \u00b7 ${formatRate(turn.tokens, turn.elapsedMs)}`
                      : ''}
                  </span>
                )}
                <CopyAnswerButton query={turn.question} answer={turn.answer} sources={turn.sources} />
                <ShareAnswerButton query={turn.question} answer={turn.answer} sources={turn.sources} />
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}

// The asked question, shown above its answer. A short uppercase label + the
// question in the serif display face, with a left accent tick on the active
// turn so the eye can find which exchange the margin rail is tracking.
function QuestionHeader({ text, active }: { text: string; active: boolean }) {
  return (
    <div className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-1 w-[3px] shrink-0 self-stretch rounded-full"
        style={{ background: active ? 'var(--cm-accent-line)' : 'var(--cm-border)' }}
      />
      <div className="min-w-0">
        <span className="cm-mono text-[10.5px] uppercase tracking-[0.14em] text-cm-faint">
          Asked
        </span>
        <h2
          className="cm-serif mt-0.5 text-[20px] leading-snug text-cm-fg"
          style={{ fontWeight: 500, letterSpacing: -0.01 }}
        >
          {text}
        </h2>
      </div>
    </div>
  );
}

// Starter prompts shown in the empty reading state. Hoisted so each one can
// be rendered as an actionable button that seeds the composer.
const STARTER_PROMPTS = [
  'what did I commit last Tuesday on snip',
  'summarise the design notes I left in memory this week',
  'where did I first sketch the citation rail idea',
];

function EmptyReading({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="max-w-[640px]">
      <h1 className="cm-display text-[44px] text-cm-fg" style={{ fontWeight: 500 }}>
        A quiet place to ask
        <span className="cm-display-soft text-cm-accent"> your workspace</span>
        <span className="text-cm-faint">.</span>
      </h1>
      <p className="mt-5 text-[15px] leading-relaxed text-cm-fg-soft">
        Type a question above. Answers arrive in plain prose with numbered marks
        in the margin, so you can follow each claim back to the file it came from.
      </p>
      <div className="mt-7 border-t border-cm-border pt-5">
        <div className="cm-mono text-[11px] uppercase tracking-wider text-cm-faint">
          A few things to try
        </div>
        <ul className="mt-3 space-y-1.5">
          {STARTER_PROMPTS.map((p) => (
            <li key={p}>
              <button
                type="button"
                onClick={() => onPick(p)}
                className="cm-starter-prompt group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[14px] text-cm-fg-soft"
              >
                <span className="cm-starter-arrow shrink-0 text-cm-faint" aria-hidden="true">
                  <IconArrowRight size={13} />
                </span>
                <span className="min-w-0">{p}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
