import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, fmtRelative } from '@/lib/api';
import { EmptyState, ErrorState, IconSpark } from '@clawmind/ui';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  let items: Awaited<ReturnType<typeof api.history>> = [];
  let error: string | null = null;
  try {
    items = await api.history();
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopNav />
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '28px 24px 80px' }}>
        <header>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, letterSpacing: -0.3 }}>History</h1>
          <p style={{ color: 'var(--cm-muted)', marginTop: 6, fontSize: 14 }}>
            Recent questions and the answers ClawMind gave.
          </p>
        </header>

        {error && (
          <div style={{ marginTop: 24 }}>
            <ErrorState title="Could not load history" message={error} />
          </div>
        )}

        {!error && items.length === 0 && (
          <div style={{ marginTop: 24 }}>
            <EmptyState
              icon={<IconSpark />}
              title="Nothing yet"
              body="Ask something on the chat page to build your history."
            />
            <div style={{ marginTop: 12, textAlign: 'center' }}>
              <Link href="/chat" style={{ padding: '8px 14px', background: 'var(--cm-accent)', color: 'white', borderRadius: 8, fontSize: 14 }}>Open chat</Link>
            </div>
          </div>
        )}

        {!error && items.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '24px 0 0', display: 'grid', gap: 12 }}>
            {items.map((it) => (
              <li key={it.id} style={{ padding: 16, border: '1px solid var(--cm-border)', borderRadius: 12 }}>
                <div style={{ fontWeight: 500 }}>{it.query}</div>
                <div style={{ marginTop: 6, color: 'var(--cm-muted)', fontSize: 14, whiteSpace: 'pre-wrap' }}>
                  {it.answer.slice(0, 280)}{it.answer.length > 280 ? '...' : ''}
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--cm-muted)' }}>
                  {fmtRelative(it.ts)} · {it.model}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
