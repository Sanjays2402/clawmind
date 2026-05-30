import Link from 'next/link';
import { Logo } from '@clawmind/ui';

export default function Landing() {
  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo />
          <span style={{ fontWeight: 600, letterSpacing: 0.2 }}>ClawMind</span>
        </div>
        <div style={{ display: 'flex', gap: 16, color: 'var(--cm-muted)', fontSize: 14 }}>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/chat">Chat</Link>
          <Link href="/sources">Sources</Link>
          <Link href="/digests">Digests</Link>
          <Link href="/ingest">Ingest</Link>
          <Link href="/saved">Saved</Link>
          <a href="https://github.com/Sanjays2402/clawmind" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </nav>
      <section style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 32 }}>
        <h1 style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.05, maxWidth: 820, margin: 0 }}>
          Your notes, your code, answered.
        </h1>
        <p style={{ marginTop: 18, fontSize: 18, color: 'var(--cm-muted)', maxWidth: 640 }}>
          ClawMind reads your OpenClaw workspace, then lets you ask anything. Everything runs on your Mac.
          Apple MLX for embeddings. LanceDB for vectors. Cited answers that link straight to file and line.
        </p>
        <div style={{ marginTop: 28, display: 'flex', gap: 12 }}>
          <Link href="/dashboard" style={{ padding: '12px 18px', background: 'var(--cm-accent)', color: 'white', borderRadius: 10, fontWeight: 500 }}>
            Open dashboard
          </Link>
          <Link href="/chat" style={{ padding: '12px 18px', border: '1px solid var(--cm-border)', borderRadius: 10, color: 'var(--cm-fg)' }}>
            Open chat
          </Link>
        </div>
      </section>
      <Features />
      <footer style={{ padding: '24px 32px', borderTop: '1px solid var(--cm-border)', color: 'var(--cm-muted)', fontSize: 13 }}>
        Built for one mind. Runs on yours.
      </footer>
    </main>
  );
}

function Features() {
  const items = [
    { title: 'Hybrid retrieval', body: 'BM25 plus dense vectors, blended with MMR rerank for diverse, on-target results.' },
    { title: 'Cited by default', body: 'Every claim carries [^n] markers that jump to the exact file and line.' },
    { title: 'Watcher rebuilds', body: 'Edit a note, the index updates a moment later. No manual reindex dance.' },
    { title: 'Local providers', body: 'MLX for embeddings, hermes-agent for chat, with a Copilot proxy as fallback.' },
  ];
  return (
    <section style={{ padding: '48px 32px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, maxWidth: 1100, margin: '0 auto', width: '100%' }}>
      {items.map((it) => (
        <div key={it.title} style={{ padding: 18, border: '1px solid var(--cm-border)', borderRadius: 12, background: 'var(--cm-subtle)' }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{it.title}</div>
          <div style={{ fontSize: 14, color: 'var(--cm-muted)' }}>{it.body}</div>
        </div>
      ))}
    </section>
  );
}
