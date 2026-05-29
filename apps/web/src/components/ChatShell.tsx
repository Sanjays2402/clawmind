'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { Logo, NamespacePicker, Spinner, ThemeToggle, type Ns } from '@clawmind/ui';
import { ChatStream } from './ChatStream';
import { SourcesPane } from './SourcesPane';
import { Composer } from './Composer';
import { api } from '@/lib/api';

interface Source { id: string; path: string; startLine: number; endLine: number; excerpt: string; score: number; }

export function ChatShell({ threadId: _t, onThread: _o }: { threadId: string | null; onThread: (id: string | null) => void }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [activeSource, setActiveSource] = useState<Source | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [namespaces, setNamespaces] = useState<Ns[]>(['memory', 'projects', 'sessions']);
  const cancelRef = useRef<boolean>(false);

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
    <main style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '260px 1fr 380px' }}>
      <aside style={{ borderRight: '1px solid var(--cm-border)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Logo size={24} />
          <span style={{ fontWeight: 600 }}>ClawMind</span>
        </Link>
        <div style={{ fontSize: 12, color: 'var(--cm-muted)', marginTop: 4 }}>Namespaces</div>
        <NamespacePicker value={namespaces} onChange={setNamespaces} />
        <div style={{ marginTop: 'auto', display: 'flex', gap: 8, fontSize: 13, color: 'var(--cm-muted)' }}>
          <Link href="/history">History</Link>
          <Link href="/saved">Saved</Link>
          <Link href="/settings">Settings</Link>
        </div>
      </aside>

      <section style={{ display: 'flex', flexDirection: 'column' }}>
        <header style={{ padding: '14px 24px', borderBottom: '1px solid var(--cm-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 500 }}>Ask</div>
          <ThemeToggle />
        </header>
        <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          {!answer && !loading && !error && (
            <div style={{ marginTop: '15vh', textAlign: 'center', color: 'var(--cm-muted)' }}>
              <div style={{ fontSize: 18, color: 'var(--cm-fg)', fontWeight: 500 }}>What would you like to know?</div>
              <div style={{ marginTop: 6 }}>Try: what did I commit last Tuesday on snip?</div>
            </div>
          )}
          {loading && answer === '' && <Spinner />}
          {error && <div style={{ color: 'var(--cm-danger)' }}>{error}</div>}
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

      <aside style={{ borderLeft: '1px solid var(--cm-border)', padding: 16, overflow: 'auto' }}>
        <SourcesPane sources={sources} active={activeSource} onSelect={setActiveSource} />
      </aside>
    </main>
  );
}
