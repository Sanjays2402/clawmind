import Link from 'next/link';

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 12, letterSpacing: 1.2, color: 'var(--cm-muted)', textTransform: 'uppercase' }}>
        404
      </div>
      <h1 style={{ fontSize: 28, fontWeight: 600, marginTop: 8, letterSpacing: -0.3 }}>
        Nothing lives here
      </h1>
      <p style={{ marginTop: 8, color: 'var(--cm-muted)', fontSize: 14, maxWidth: 420 }}>
        The page you tried to open is missing or moved. Pick a place to land below.
      </p>
      <div style={{ marginTop: 20, display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link
          href="/dashboard"
          style={{
            padding: '8px 14px',
            background: 'var(--cm-accent)',
            color: 'white',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          Open dashboard
        </Link>
        <Link
          href="/chat"
          style={{
            padding: '8px 14px',
            border: '1px solid var(--cm-border)',
            borderRadius: 8,
            fontSize: 14,
            color: 'var(--cm-fg)',
          }}
        >
          Open chat
        </Link>
        <Link
          href="/sources"
          style={{
            padding: '8px 14px',
            border: '1px solid var(--cm-border)',
            borderRadius: 8,
            fontSize: 14,
            color: 'var(--cm-fg)',
          }}
        >
          Browse sources
        </Link>
      </div>
    </main>
  );
}
