import Link from 'next/link';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const items = await api.history().catch(() => []);
  return (
    <main style={{ maxWidth: 900, margin: '40px auto', padding: '0 24px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 600 }}>History</h1>
      <p style={{ color: 'var(--cm-muted)', marginTop: 4 }}>Recent questions and the answers ClawMind gave.</p>
      <div style={{ marginTop: 24, display: 'grid', gap: 12 }}>
        {items.length === 0 && <div style={{ color: 'var(--cm-muted)' }}>Nothing yet. Ask something on the chat page.</div>}
        {items.map((it) => (
          <div key={it.id} style={{ padding: 16, border: '1px solid var(--cm-border)', borderRadius: 10 }}>
            <div style={{ fontWeight: 500 }}>{it.query}</div>
            <div style={{ marginTop: 6, color: 'var(--cm-muted)', fontSize: 14, whiteSpace: 'pre-wrap' }}>{it.answer.slice(0, 240)}{it.answer.length > 240 ? '...' : ''}</div>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--cm-muted)' }}>{new Date(it.ts).toLocaleString()}  ·  {it.model}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 24 }}><Link href="/chat" style={{ color: 'var(--cm-accent)' }}>Back to chat</Link></div>
    </main>
  );
}
