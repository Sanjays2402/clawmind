'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { TopNav } from '@/components/TopNav';
import { NamespacePicker, type Ns, ChatAnswerSkeleton, SourcesRailSkeleton } from '@clawmind/ui';
import { ChatStream } from './ChatStream';
import { SourcesPane } from './SourcesPane';
import { Composer } from './Composer';
import { ShareAnswerButton } from './ShareAnswerButton';
import { CopyAnswerButton } from './CopyAnswerButton';
import { api } from '@/lib/api';

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

export function ChatShell({
  threadId: _t,
  onThread: _o,
}: {
  threadId: string | null;
  onThread: (id: string | null) => void;
}) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [activeSource, setActiveSource] = useState<Source | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [namespaces, setNamespaces] = useState<Ns[]>(['memory', 'projects', 'sessions']);
  const cancelRef = useRef<boolean>(false);
  const searchParams = useSearchParams();
  const prefillRef = useRef<string | null>(null);

  useEffect(() => {
    const initial = searchParams.get('q');
    if (!initial || prefillRef.current === initial) return;
    prefillRef.current = initial;
    setQuestion(initial);
  }, [searchParams]);

  async function submit() {
    if (!question.trim() || loading) return;
    setLoading(true);
    setError(null);
    setAnswer('');
    setSources([]);
    setActiveSource(null);
    cancelRef.current = false;
    try {
      await api.stream({ q: question, namespaces }, (evt) => {
        if (cancelRef.current) return;
        if (evt.type === 'sources') setSources(evt.value as Source[]);
        if (evt.type === 'token') setAnswer((a) => a + (evt.value as string));
        if (evt.type === 'error') setError((evt.value as { message: string }).message);
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col bg-cm-bg">
      <TopNav />

      {/* Breadcrumb namespace header */}
      <div className="border-b border-cm-border">
        <div className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-4 px-6 py-3 sm:px-10">
          <NamespacePicker value={namespaces} onChange={setNamespaces} variant="breadcrumb" />
          <span className="cm-mono text-[11px] text-cm-faint">
            cmd + enter to ask &middot; tab to cycle prompts
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
          />

          <div className="mt-8">
            {!answer && !loading && !error && (
              <EmptyReading />
            )}
            {loading && answer === '' && (
              <ChatAnswerSkeleton />
            )}
            {error && (
              <div className="rounded-md border border-cm-border bg-cm-paper p-4 text-sm text-cm-danger">
                {error}
              </div>
            )}
            {answer && (
              <>
                <ChatStream
                  text={answer}
                  sources={sources}
                  activeId={activeSource?.id ?? null}
                  onCite={setActiveSource}
                />
                {!loading && (
                  <div className="mt-6 flex items-center justify-end gap-2 border-t border-cm-border pt-4">
                    <CopyAnswerButton
                      query={question}
                      answer={answer}
                      sources={sources}
                    />
                    <ShareAnswerButton
                      query={question}
                      answer={answer}
                      sources={sources}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          {loading && sources.length === 0 ? (
            <SourcesRailSkeleton />
          ) : (
            <SourcesPane sources={sources} active={activeSource} onSelect={setActiveSource} />
          )}
        </aside>
      </div>
    </main>
  );
}

function EmptyReading() {
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
        <ul className="mt-3 space-y-2 text-[14px] text-cm-fg-soft">
          <li>what did I commit last Tuesday on snip</li>
          <li>summarise the design notes I left in memory this week</li>
          <li>where did I first sketch the citation rail idea</li>
        </ul>
      </div>
    </div>
  );
}
