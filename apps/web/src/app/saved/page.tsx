import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function SavedPage() {
  const items = await api.savedList().catch(() => []);
  return (
    <main style={{ maxWidth: 900, margin: '40px auto', padding: '0 24px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 600 }}>Saved questions</h1>
      {items.length === 0 ? (
        <p style={{ color: 'var(--cm-muted)', marginTop: 12 }}>Pin a question from the chat panel and it shows up here.</p>
      ) : (
        <ul style={{ marginTop: 16, listStyle: 'none', padding: 0 }}>
          {items.map((i) => (
            <li key={i.id} style={{ padding: 12, borderBottom: '1px solid var(--cm-border)' }}>
              <div style={{ fontWeight: 500 }}>{i.title}</div>
              <div style={{ fontSize: 13, color: 'var(--cm-muted)' }}>{i.query}</div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
