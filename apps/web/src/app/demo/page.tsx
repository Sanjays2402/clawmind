'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, type Source } from '@/lib/api';
import {
  Logo,
  Spinner,
  IconSpark,
  IconArrowRight,
  IconBook,
  IconFolder,
  IconChat,
  IconClockCountdown,
  IconCheck,
  IconWarning,
} from '@clawmind/ui';

interface Sample {
  id: string;
  title: string;
  question: string;
  hint: string;
  namespaces: string[];
  Icon: typeof IconSpark;
}

const SAMPLES: Sample[] = [
  {
    id: 'hermes',
    title: 'Cross-day project recap',
    question: 'What changes shipped to the hermes-agent over the last month, and who should I follow up with?',
    hint: 'Pulls from daily notes plus the hermes-tools project to stitch a recap with followups.',
    namespaces: ['memory', 'projects'],
    Icon: IconChat,
  },
  {
    id: 'infra',
    title: 'Incident lookback',
    question: 'Summarize the kernel panic incidents and how the machine was recovered each time.',
    hint: 'Finds repeated infra entries across daily memory notes and reconstructs the timeline.',
    namespaces: ['memory'],
    Icon: IconClockCountdown,
  },
  {
    id: 'taskflow',
    title: 'Decisions and design notes',
    question: 'What is the TaskFlow inbox triage pattern and when does it run?',
    hint: 'Reads design notes seeded in projects and ties them to the day they were captured.',
    namespaces: ['memory', 'projects', 'sessions'],
    Icon: IconBook,
  },
];

export default function DemoPage() {
  const [active, setActive] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [namespaces, setNamespaces] = useState<string[]>(['memory', 'projects', 'sessions']);
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [firstTokenMs, setFirstTokenMs] = useState<number | null>(null);
  const cancelRef = useRef(false);
  const startRef = useRef<number>(0);

  async function run(q: string, ns: string[], sampleId: string | null) {
    if (!q.trim() || loading) return;
    setActive(sampleId);
    setQuestion(q);
    setNamespaces(ns);
    setLoading(true);
    setError(null);
    setAnswer('');
    setSources([]);
    setLatencyMs(null);
    setFirstTokenMs(null);
    cancelRef.current = false;
    startRef.current = performance.now();
    let gotFirst = false;
    try {
      await api.stream({ q, namespaces: ns }, (evt) => {
        if (cancelRef.current) return;
        if (evt.type === 'sources') setSources(evt.value as Source[]);
        if (evt.type === 'token') {
          if (!gotFirst) {
            gotFirst = true;
            setFirstTokenMs(Math.round(performance.now() - startRef.current));
          }
          setAnswer((a) => a + (evt.value as string));
        }
        if (evt.type === 'error') {
          setError((evt.value as { message: string }).message);
        }
      });
      setLatencyMs(Math.round(performance.now() - startRef.current));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Keyboard: cmd/ctrl + enter submits free-text composer
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        run(question, namespaces, null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [question, namespaces, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const showEmpty = !loading && !answer && !error;

  return (
    <main className="min-h-screen flex flex-col bg-cm-bg">
      <TopNav />

      <section className="mx-auto w-full max-w-[1180px] px-6 pt-12 pb-6 sm:px-10">
        <div className="flex items-center gap-2 text-[12px] text-cm-faint">
          <Logo size={14} />
          <span className="cm-mono uppercase tracking-[0.14em]">Live demo</span>
        </div>
        <h1 className="cm-display mt-4 text-[40px] sm:text-[56px] leading-[1.02] text-cm-fg">
          Ask the seeded knowledge pack.
        </h1>
        <p className="mt-4 max-w-[640px] text-[15px] leading-relaxed text-cm-muted">
          ClawMind is a personal RAG over your notes. This page runs against a seeded sample of
          daily memory, sessions, and project notes. Pick a sample question or write your own.
          Answers stream in with citations you can open.
        </p>
      </section>

      <section className="mx-auto w-full max-w-[1180px] px-6 sm:px-10">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {SAMPLES.map((s) => {
            const isActive = active === s.id;
            return (
              <button
                key={s.id}
                onClick={() => run(s.question, s.namespaces, s.id)}
                disabled={loading}
                className={`group text-left rounded-xl border bg-cm-bg p-5 transition
                  ${isActive ? 'border-cm-accent shadow-[0_0_0_1px_var(--cm-accent)]' : 'border-cm-border hover:border-cm-fg/40'}
                  disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                <div className="flex items-center gap-2 text-cm-fg">
                  <s.Icon size={16} />
                  <span className="text-[13px] font-medium">{s.title}</span>
                </div>
                <p className="mt-3 text-[14px] leading-snug text-cm-fg">{s.question}</p>
                <p className="mt-3 text-[12px] leading-relaxed text-cm-muted">{s.hint}</p>
                <div className="mt-4 flex items-center justify-between">
                  <div className="flex items-center gap-1 flex-wrap">
                    {s.namespaces.map((n) => (
                      <span
                        key={n}
                        className="cm-mono rounded-md border border-cm-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-cm-faint"
                      >
                        {n}
                      </span>
                    ))}
                  </div>
                  <span className="flex items-center gap-1 text-[12px] text-cm-muted group-hover:text-cm-fg">
                    Try it
                    <IconArrowRight size={12} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1180px] px-6 sm:px-10 mt-8">
        <div className="rounded-xl border border-cm-border bg-cm-bg p-4 sm:p-5">
          <label htmlFor="demo-q" className="cm-mono text-[10px] uppercase tracking-[0.14em] text-cm-faint">
            Or ask your own
          </label>
          <div className="mt-2 flex items-start gap-3">
            <textarea
              id="demo-q"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What did I decide about the inbox triage cron?"
              rows={2}
              className="flex-1 resize-none rounded-md border border-cm-border bg-cm-bg p-3 text-[14px] text-cm-fg outline-none focus:border-cm-fg/50"
            />
            <button
              onClick={() => run(question, namespaces, null)}
              disabled={loading || !question.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-cm-fg px-4 py-2.5 text-[13px] font-medium text-cm-bg disabled:opacity-50"
            >
              <IconSpark size={14} />
              Ask
            </button>
          </div>
          <p className="cm-mono mt-2 text-[11px] text-cm-faint">cmd + enter to ask</p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1180px] flex-1 px-6 pb-24 pt-8 sm:px-10">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
          <div className="min-w-0">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="cm-mono text-[11px] uppercase tracking-[0.14em] text-cm-faint">Answer</h2>
              <div className="flex items-center gap-3 text-[11px] text-cm-faint cm-mono">
                {firstTokenMs != null && <span>first token {firstTokenMs} ms</span>}
                {latencyMs != null && (
                  <span className="flex items-center gap-1">
                    <IconCheck size={11} />
                    {latencyMs} ms
                  </span>
                )}
              </div>
            </div>

            {showEmpty && (
              <div className="rounded-xl border border-dashed border-cm-border p-10 text-center">
                <IconSpark size={20} />
                <p className="mt-3 text-[14px] text-cm-fg">Pick a sample above or write a question.</p>
                <p className="mt-1 text-[12px] text-cm-muted">
                  Answers cite the underlying note so you can open the source.
                </p>
              </div>
            )}

            {loading && !answer && (
              <div className="rounded-xl border border-cm-border p-6">
                <div className="flex items-center gap-3 text-[13px] text-cm-muted">
                  <Spinner />
                  Retrieving from {namespaces.join(', ')}
                </div>
                <div className="mt-5 space-y-2">
                  <div className="h-3 w-11/12 animate-pulse rounded bg-cm-border/60" />
                  <div className="h-3 w-9/12 animate-pulse rounded bg-cm-border/60" />
                  <div className="h-3 w-10/12 animate-pulse rounded bg-cm-border/60" />
                  <div className="h-3 w-7/12 animate-pulse rounded bg-cm-border/60" />
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-cm-border bg-cm-bg p-5">
                <div className="flex items-center gap-2 text-[13px] text-cm-fg">
                  <IconWarning size={14} />
                  Something went wrong.
                </div>
                <p className="mt-2 text-[12px] text-cm-muted">{error}</p>
                <p className="mt-3 text-[12px] text-cm-muted">
                  Make sure the API is running on{' '}
                  <span className="cm-mono">127.0.0.1:7410</span> and the sample pack is ingested.
                </p>
              </div>
            )}

            {answer && (
              <article className="rounded-xl border border-cm-border bg-cm-bg p-6">
                <pre className="whitespace-pre-wrap break-words font-sans text-[15px] leading-relaxed text-cm-fg">
                  {answer}
                  {loading && <span className="ml-0.5 inline-block h-3.5 w-1 animate-pulse bg-cm-fg align-middle" />}
                </pre>
              </article>
            )}
          </div>

          <aside className="min-w-0">
            <h2 className="cm-mono mb-3 text-[11px] uppercase tracking-[0.14em] text-cm-faint">
              Sources {sources.length > 0 && <span className="text-cm-muted">· {sources.length}</span>}
            </h2>
            {sources.length === 0 ? (
              <div className="rounded-xl border border-dashed border-cm-border p-5 text-[12px] text-cm-muted">
                Citations appear here as the model retrieves them.
              </div>
            ) : (
              <ol className="space-y-2">
                {sources.map((s, i) => (
                  <li key={s.id ?? i} className="rounded-lg border border-cm-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-[12px] text-cm-fg">
                        <IconFolder size={12} />
                        <span className="truncate">{s.displayPath ?? s.path}</span>
                      </span>
                      <span className="cm-mono text-[10px] text-cm-faint">
                        {(s.score ?? 0).toFixed(2)}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-3 text-[12px] leading-snug text-cm-muted">
                      {s.excerpt}
                    </p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="cm-mono text-[10px] text-cm-faint">
                        L{s.startLine}-{s.endLine}
                      </span>
                      <Link
                        href={`/sources/view?path=${encodeURIComponent(s.path)}`}
                        className="cm-mono text-[10px] text-cm-fg hover:underline"
                      >
                        open source
                      </Link>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}
