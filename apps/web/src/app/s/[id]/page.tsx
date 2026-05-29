import { api } from '@/lib/api';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await api.share(id).catch(() => null);
  if (!data) return notFound();
  return (
    <main style={{ maxWidth: 760, margin: '40px auto', padding: '0 24px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600 }}>{data.query}</h1>
      <article style={{ marginTop: 16, color: 'var(--cm-fg)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{data.answer}</article>
    </main>
  );
}
