import { api, type Source } from '@/lib/api';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { CopyLink } from './CopyLink';

export const dynamic = 'force-dynamic';

function trim(s: string, n: number): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length <= n ? clean : clean.slice(0, n - 1).trimEnd() + '\u2026';
}

function formatWhen(ts?: number): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const data = await api.share(id).catch(() => null);
  if (!data) {
    return { title: 'Shared answer not found · ClawMind' };
  }
  const title = trim(data.query, 80);
  const description = trim(data.answer, 200);
  const ogPath = `/s/${id}/opengraph-image`;
  return {
    title: `${title} · ClawMind`,
    description,
    openGraph: {
      title,
      description,
      type: 'article',
      siteName: 'ClawMind',
      url: `/s/${id}`,
      images: [{ url: ogPath, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogPath],
    },
    robots: { index: false, follow: false },
  };
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await api.share(id).catch(() => null);
  if (!data) return notFound();

  const sources: Source[] = Array.isArray(data.sources)
    ? (data.sources.filter((s): s is Source => !!s && typeof s === 'object' && 'path' in (s as object)) as Source[])
    : [];
  const when = formatWhen(data.createdAt);

  return (
    <main className="cm-share">
      <header className="cm-share__bar">
        <Link href="/" className="cm-share__brand" aria-label="ClawMind home">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 7l8-4 8 4-8 4-8-4z"
              fill="currentColor"
              fillOpacity="0.25"
            />
            <path
              d="M4 12l8 4 8-4M4 17l8 4 8-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>ClawMind</span>
        </Link>
        <div className="cm-share__actions">
          <CopyLink id={id} />
        </div>
      </header>

      <section className="cm-share__hero">
        <div className="cm-share__eyebrow">Shared answer</div>
        <h1 className="cm-share__q">{data.query}</h1>
        {when ? <div className="cm-share__meta">{when}</div> : null}
      </section>

      <article className="cm-share__a cm-chat-stream" aria-label="Answer">
        {data.answer}
      </article>

      {sources.length > 0 ? (
        <section className="cm-share__sources" aria-label="Sources">
          <div className="cm-share__sources-h">
            {sources.length} {sources.length === 1 ? 'source' : 'sources'}
          </div>
          <ol className="cm-share__sources-list">
            {sources.map((s, i) => {
              const title = (s.displayPath?.trim()) || basename(s.path);
              const lines =
                Number.isFinite(s.startLine) && Number.isFinite(s.endLine)
                  ? `L${s.startLine}\u2013${s.endLine}`
                  : '';
              return (
                <li key={s.id || `${s.path}-${i}`} className="cm-share__source">
                  <div className="cm-share__source-head">
                    <span className="cm-share__source-n">[{i + 1}]</span>
                    <span className="cm-share__source-title">{title}</span>
                    {lines ? <span className="cm-share__source-lines">{lines}</span> : null}
                  </div>
                  {s.path && s.path !== title ? (
                    <div className="cm-share__source-path">{s.path}</div>
                  ) : null}
                  {s.excerpt ? <pre className="cm-share__source-excerpt">{trim(s.excerpt, 480)}</pre> : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      <footer className="cm-share__cta">
        <div className="cm-share__cta-text">
          <strong>Want answers like this over your own notes and code?</strong>
          <span>ClawMind runs locally and cites every source.</span>
        </div>
        <Link href="/" className="cm-share__cta-btn">
          Try ClawMind
        </Link>
      </footer>
    </main>
  );
}
