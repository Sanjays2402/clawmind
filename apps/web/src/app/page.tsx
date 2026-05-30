import Link from 'next/link';
import { Logo } from '@clawmind/ui';
import { api, fmtBytes, fmtRelative } from '@/lib/api';

export const dynamic = 'force-dynamic';

type LandingData = {
  stats: Awaited<ReturnType<typeof api.stats>> | null;
  history: Awaited<ReturnType<typeof api.history>>;
  apiUp: boolean;
};

async function load(): Promise<LandingData> {
  const safe = async <T,>(p: Promise<T>): Promise<T | null> => {
    try { return await p; } catch { return null; }
  };
  const [stats, history, health] = await Promise.all([
    safe(api.stats()),
    safe(api.history()),
    safe(api.health()),
  ]);
  return { stats, history: history ?? [], apiUp: !!health?.ok };
}

export default async function Landing() {
  const { stats, history, apiUp } = await load();
  const recent = history.slice(0, 3);

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo />
          <span style={{ fontWeight: 600, letterSpacing: 0.2 }}>ClawMind</span>
        </div>
        <div style={{ display: 'flex', gap: 16, color: 'var(--cm-muted)', fontSize: 14, alignItems: 'center' }}>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/chat">Chat</Link>
          <Link href="/sources">Sources</Link>
          <Link href="/digests">Digests</Link>
          <Link href="/ingest">Ingest</Link>
          <Link href="/saved">Saved</Link>
          <a href="https://github.com/Sanjays2402/clawmind" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </nav>

      <section style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '48px 32px 24px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 999, border: '1px solid var(--cm-border)', background: 'var(--cm-subtle)', fontSize: 12, color: 'var(--cm-muted)', marginBottom: 18 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: apiUp ? '#16a34a' : '#9ca3af' }} />
          {apiUp ? 'Local API online' : 'Local API offline'}
        </div>
        <h1 style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.05, maxWidth: 820, margin: 0, letterSpacing: -0.5 }}>
          Your notes, your code, answered.
        </h1>
        <p style={{ marginTop: 18, fontSize: 18, color: 'var(--cm-muted)', maxWidth: 640 }}>
          ClawMind reads your OpenClaw workspace, then lets you ask anything. Everything runs on your Mac.
          Apple MLX for embeddings. LanceDB for vectors. Cited answers that link straight to file and line.
        </p>
        <div style={{ marginTop: 28, display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link href="/dashboard" style={{ padding: '12px 18px', background: 'var(--cm-accent)', color: 'white', borderRadius: 10, fontWeight: 500 }}>
            Open dashboard
          </Link>
          <Link href="/chat" style={{ padding: '12px 18px', border: '1px solid var(--cm-border)', borderRadius: 10, color: 'var(--cm-fg)' }}>
            Open chat
          </Link>
        </div>
      </section>

      <LiveStats stats={stats} apiUp={apiUp} />
      <RecentQuestions recent={recent} apiUp={apiUp} />

      <footer style={{ padding: '24px 32px', borderTop: '1px solid var(--cm-border)', color: 'var(--cm-muted)', fontSize: 13, marginTop: 'auto' }}>
        Built for one mind. Runs on yours.
      </footer>
    </main>
  );
}

function LiveStats({ stats, apiUp }: { stats: LandingData['stats']; apiUp: boolean }) {
  const tiles = [
    { label: 'Files indexed', value: stats ? stats.totals.files.toLocaleString() : '-' },
    { label: 'Chunks', value: stats ? stats.totals.chunks.toLocaleString() : '-' },
    { label: 'On disk', value: stats ? fmtBytes(stats.totals.bytes) : '-' },
    { label: 'Namespaces', value: stats ? stats.totals.namespaces.toLocaleString() : '-' },
  ];
  return (
    <section style={{ padding: '32px 32px 8px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--cm-muted)', textTransform: 'uppercase', letterSpacing: 0.6, margin: 0 }}>Workspace</h2>
        {stats && (
          <Link href="/stats" style={{ fontSize: 13, color: 'var(--cm-muted)' }}>View stats</Link>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {tiles.map((t) => (
          <div key={t.label} style={{ padding: 16, border: '1px solid var(--cm-border)', borderRadius: 12, background: 'var(--cm-subtle)' }}>
            <div style={{ fontSize: 12, color: 'var(--cm-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t.label}</div>
            <div style={{ fontSize: 24, fontWeight: 600, marginTop: 6, letterSpacing: -0.3 }}>{t.value}</div>
          </div>
        ))}
      </div>
      {!apiUp && (
        <p style={{ fontSize: 13, color: 'var(--cm-muted)', marginTop: 12 }}>
          Start the API to populate live numbers. Run <code>pnpm --filter @clawmind/api dev</code>.
        </p>
      )}
    </section>
  );
}

function RecentQuestions({ recent, apiUp }: { recent: LandingData['history']; apiUp: boolean }) {
  return (
    <section style={{ padding: '24px 32px 56px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--cm-muted)', textTransform: 'uppercase', letterSpacing: 0.6, margin: 0 }}>Recent questions</h2>
        <Link href="/history" style={{ fontSize: 13, color: 'var(--cm-muted)' }}>All history</Link>
      </div>
      {recent.length === 0 ? (
        <div style={{ padding: 24, border: '1px dashed var(--cm-border)', borderRadius: 12, textAlign: 'center', color: 'var(--cm-muted)', fontSize: 14 }}>
          {apiUp ? (
            <>No questions yet. <Link href="/chat" style={{ color: 'var(--cm-accent)' }}>Ask the first one.</Link></>
          ) : (
            'History will appear here once the API is reachable.'
          )}
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {recent.map((h) => (
            <li key={h.id}>
              <Link
                href={`/chat?q=${encodeURIComponent(h.query)}`}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', border: '1px solid var(--cm-border)', borderRadius: 10, background: 'var(--cm-subtle)', color: 'var(--cm-fg)' }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.query}</span>
                <span style={{ fontSize: 12, color: 'var(--cm-muted)', whiteSpace: 'nowrap' }}>{fmtRelative(h.ts)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
