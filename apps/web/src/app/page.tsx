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
  const recent = history.slice(0, 4);

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 40px',
          borderBottom: '1px solid var(--cm-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo size={24} />
          <span
            className="cm-serif"
            style={{ fontSize: 19, fontWeight: 500, letterSpacing: -0.01 }}
          >
            ClawMind
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 22,
            color: 'var(--cm-muted)',
            fontSize: 13.5,
            alignItems: 'center',
          }}
        >
          <Link href="/chat">Ask</Link>
          <Link href="/demo">Demo</Link>
          <Link href="/sources">Sources</Link>
          <Link href="/saved">Saved</Link>
          <Link href="/dashboard">Dashboard</Link>
          <a href="https://github.com/Sanjays2402/clawmind" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </nav>

      <section
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          alignItems: 'center',
          padding: '96px 40px 56px',
          maxWidth: 1100,
          margin: '0 auto',
          width: '100%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: apiUp ? 'var(--cm-success)' : 'var(--cm-faint)',
            }}
          />
          <span className="cm-mono" style={{ fontSize: 11, color: 'var(--cm-muted)', letterSpacing: 0.4 }}>
            {apiUp ? 'local index online' : 'local index offline'}
          </span>
        </div>

        <h1
          className="cm-display"
          style={{
            fontSize: 'clamp(48px, 7vw, 84px)',
            fontWeight: 500,
            margin: 0,
            maxWidth: 880,
            color: 'var(--cm-fg)',
          }}
        >
          A quiet study
          <span className="cm-display-soft" style={{ color: 'var(--cm-accent)' }}> for one mind</span>
          <span style={{ color: 'var(--cm-faint)' }}>.</span>
        </h1>

        <p
          style={{
            marginTop: 26,
            fontSize: 18.5,
            lineHeight: 1.55,
            color: 'var(--cm-fg-soft)',
            maxWidth: 620,
            fontFamily: 'var(--cm-font)',
          }}
        >
          ClawMind reads your OpenClaw workspace and lets you ask it questions in plain words. Everything stays on this Mac. Apple MLX handles the embeddings, LanceDB holds the vectors, and every claim is marked back to the line it came from.
        </p>

        <div style={{ marginTop: 34, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link
            href="/chat"
            style={{
              padding: '12px 20px',
              background: 'var(--cm-accent)',
              color: '#FBFAF6',
              borderRadius: 8,
              fontWeight: 500,
              fontSize: 14.5,
            }}
          >
            Open the study
          </Link>
          <Link
            href="/demo"
            style={{
              padding: '12px 20px',
              border: '1px solid var(--cm-border)',
              borderRadius: 8,
              color: 'var(--cm-fg)',
              background: 'var(--cm-paper)',
              fontSize: 14.5,
            }}
          >
            Try a sample
          </Link>
          <Link
            href="/dashboard"
            style={{
              padding: '12px 20px',
              border: '1px solid var(--cm-border)',
              borderRadius: 8,
              color: 'var(--cm-fg)',
              background: 'var(--cm-paper)',
              fontSize: 14.5,
            }}
          >
            See the workshop
          </Link>
        </div>
      </section>

      <LiveStats stats={stats} apiUp={apiUp} />
      <RecentQuestions recent={recent} apiUp={apiUp} />

      <footer
        style={{
          padding: '28px 40px',
          borderTop: '1px solid var(--cm-border)',
          color: 'var(--cm-faint)',
          fontSize: 13,
          marginTop: 'auto',
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <span className="cm-serif" style={{ fontStyle: 'italic', fontVariationSettings: "'opsz' 16, 'SOFT' 100" }}>
          Built for one mind. Runs on yours.
        </span>
        <span className="cm-mono" style={{ fontSize: 11 }}>v0.1</span>
      </footer>
    </main>
  );
}

function LiveStats({ stats, apiUp }: { stats: LandingData['stats']; apiUp: boolean }) {
  const tiles = [
    { label: 'Files read', value: stats ? stats.totals.files.toLocaleString() : '·' },
    { label: 'Passages', value: stats ? stats.totals.chunks.toLocaleString() : '·' },
    { label: 'On disk', value: stats ? fmtBytes(stats.totals.bytes) : '·' },
    { label: 'Namespaces', value: stats ? stats.totals.namespaces.toLocaleString() : '·' },
  ];
  return (
    <section style={{ padding: '24px 40px 12px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2
          className="cm-mono"
          style={{
            fontSize: 11,
            color: 'var(--cm-faint)',
            textTransform: 'uppercase',
            letterSpacing: 1.4,
            margin: 0,
          }}
        >
          The shelf
        </h2>
        {stats && (
          <Link href="/stats" style={{ fontSize: 12.5, color: 'var(--cm-muted)' }}>full inventory</Link>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {tiles.map((t) => (
          <div
            key={t.label}
            style={{
              padding: '18px 18px 16px',
              border: '1px solid var(--cm-border)',
              borderRadius: 10,
              background: 'var(--cm-paper)',
            }}
          >
            <div
              className="cm-mono"
              style={{
                fontSize: 10.5,
                color: 'var(--cm-faint)',
                textTransform: 'uppercase',
                letterSpacing: 1.2,
              }}
            >
              {t.label}
            </div>
            <div
              className="cm-serif"
              style={{
                fontSize: 28,
                fontWeight: 500,
                marginTop: 8,
                letterSpacing: -0.01,
                color: 'var(--cm-fg)',
              }}
            >
              {t.value}
            </div>
          </div>
        ))}
      </div>
      {!apiUp && (
        <p style={{ fontSize: 13, color: 'var(--cm-muted)', marginTop: 12 }}>
          Start the local index to populate live numbers. Run <code className="cm-mono" style={{ background: 'var(--cm-subtle)', padding: '1px 6px', borderRadius: 4 }}>pnpm --filter @clawmind/api dev</code>.
        </p>
      )}
    </section>
  );
}

function RecentQuestions({ recent, apiUp }: { recent: LandingData['history']; apiUp: boolean }) {
  return (
    <section style={{ padding: '20px 40px 64px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2
          className="cm-mono"
          style={{
            fontSize: 11,
            color: 'var(--cm-faint)',
            textTransform: 'uppercase',
            letterSpacing: 1.4,
            margin: 0,
          }}
        >
          Recently asked
        </h2>
        <Link href="/history" style={{ fontSize: 12.5, color: 'var(--cm-muted)' }}>all questions</Link>
      </div>
      {recent.length === 0 ? (
        <div
          style={{
            padding: 26,
            border: '1px dashed var(--cm-border)',
            borderRadius: 10,
            textAlign: 'center',
            color: 'var(--cm-muted)',
            fontSize: 14,
            background: 'var(--cm-paper)',
          }}
        >
          {apiUp ? (
            <>Nothing yet. <Link href="/chat" style={{ color: 'var(--cm-accent)' }}>Ask the first thing.</Link></>
          ) : (
            'Questions will gather here once the index is running.'
          )}
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {recent.map((h) => (
            <li key={h.id}>
              <Link
                href={`/chat?q=${encodeURIComponent(h.query)}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '13px 16px',
                  border: '1px solid var(--cm-border)',
                  borderRadius: 8,
                  background: 'var(--cm-paper)',
                  color: 'var(--cm-fg)',
                }}
              >
                <span
                  className="cm-serif"
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 15,
                    fontVariationSettings: "'opsz' 16, 'SOFT' 70",
                  }}
                >
                  {h.query}
                </span>
                <span className="cm-mono" style={{ fontSize: 11, color: 'var(--cm-faint)', whiteSpace: 'nowrap' }}>
                  {fmtRelative(h.ts)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
