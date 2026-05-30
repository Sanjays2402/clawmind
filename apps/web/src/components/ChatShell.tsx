'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { TopNav } from '@/components/TopNav';
import { NamespacePicker, Spinner, type Ns } from '@clawmind/ui';
import { ChatStream } from './ChatStream';
import { SourcesPane } from './SourcesPane';
import { Composer } from './Composer';
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
    <main className="min-h-screen flex flex-col">
      <TopNav />
      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[220px_1fr_320px]">
        <aside className="hidden border-r border-cm-border p-4 lg:flex lg:flex-col lg:gap-3">
          <div className="text-xs uppercase tracking-wide text-cm-muted">Namespaces</div>
          <NamespacePicker value={namespaces} onChange={setNamespaces} />
        </aside>

        <section className="flex flex-col">
          <div className="flex-1 overflow-auto px-4 py-6 sm:px-8">
            {!answer && !loading && !error && (
              <div className="mx-auto max-w-xl pt-[12vh] text-center text-cm-muted">
                <div className="text-lg font-medium text-cm-fg">What would you like to know?</div>
                <div className="mt-1.5 text-sm">
                  Try: what did I commit last Tuesday on snip?
                </div>
              </div>
            )}
            {loading && answer === '' && (
              <div className="flex justify-center pt-12"><Spinner /></div>
            )}
            {error && (
              <div className="mx-auto max-w-xl rounded-md border border-cm-danger/40 bg-cm-danger/5 p-3 text-sm text-cm-danger">
                {error}
              </div>
            )}
            {answer && <ChatStream text={answer} sources={sources} onCite={setActiveSource} />}
          </div>
          <Composer
            value={question}
            onChange={setQuestion}
            onSubmit={submit}
            loading={loading}
            onStop={() => { cancelRef.current = true; setLoading(false); }}
          />
        </section>

        <aside className="border-t border-cm-border p-4 lg:border-l lg:border-t-0 lg:overflow-auto">
          <SourcesPane sources={sources} active={activeSource} onSelect={setActiveSource} />
        </aside>
      </div>
    </main>
  );
}
