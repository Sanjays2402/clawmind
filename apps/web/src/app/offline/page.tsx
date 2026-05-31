import Link from 'next/link';

export const metadata = {
  title: 'Offline · ClawMind',
};

export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
      }}
    >
      <div style={{ maxWidth: 460, textAlign: 'center' }}>
        <div
          aria-hidden
          style={{
            margin: '0 auto 18px',
            width: 56,
            height: 56,
            borderRadius: 14,
            background:
              'linear-gradient(135deg, rgba(124,92,255,0.15), rgba(67,211,225,0.15))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
          }}
        >
          ☁︎
        </div>
        <h1
          className="cm-serif"
          style={{ fontSize: 26, fontWeight: 500, marginBottom: 10, letterSpacing: -0.01 }}
        >
          You are offline
        </h1>
        <p style={{ color: 'var(--cm-muted, #666)', fontSize: 14.5, lineHeight: 1.5 }}>
          ClawMind needs your local API to think. Reconnect and try again, or open
          something you visited earlier.
        </p>
        <div
          style={{
            marginTop: 22,
            display: 'flex',
            gap: 10,
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Link
            href="/"
            style={{
              padding: '9px 14px',
              borderRadius: 8,
              border: '1px solid #7c5cff',
              background: '#7c5cff',
              color: 'white',
              fontSize: 13.5,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Try home
          </Link>
          <Link
            href="/saved"
            style={{
              padding: '9px 14px',
              borderRadius: 8,
              border: '1px solid var(--cm-border, #e5e5e5)',
              color: 'inherit',
              fontSize: 13.5,
              textDecoration: 'none',
            }}
          >
            Open Saved
          </Link>
        </div>
      </div>
    </main>
  );
}
