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
      <h1 className="cm-display" style={{ fontSize: 44, fontWeight: 500, marginTop: 10, color: 'var(--cm-fg)' }}>
        Nothing on this page.
      </h1>
      <p style={{ marginTop: 10, color: 'var(--cm-muted)', fontSize: 15, maxWidth: 460, lineHeight: 1.55 }}>
        The shelf you reached is empty, or the page has moved. Pick a quieter room below.
      </p>
      <div style={{ marginTop: 20, display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link
          href="/dashboard"
          style={{
            padding: '8px 14px',
            background: 'var(--cm-accent)',
            color: '#FBFAF6',
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
