import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { FeedbackForm } from '@/components/FeedbackForm';
import { TagEditor } from '@/components/TagEditor';
import { api, fmtBytes, fmtRelative } from '@/lib/api';
import { IconFolder, IconArrowRight, IconWarning } from '@clawmind/ui';

export const dynamic = 'force-dynamic';

type SP = Promise<{ path?: string; start?: string; end?: string }>;

export default async function SourceView({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const path = sp.path?.trim();

  if (!path) {
    return (
      <Shell>
        <h1 style={h1}>Source viewer</h1>
        <p style={muted}>No path given. Open a source from the <Link href="/sources" style={link}>sources list</Link>.</p>
      </Shell>
    );
  }

  const start = sp.start ? Number(sp.start) : undefined;
  const end = sp.end ? Number(sp.end) : undefined;

  const [fileRes, listRes, feedbackRes] = await Promise.all([
    api.sourceFile(path, start, end).catch((e: Error) => ({ error: e.message })),
    api.sourcesList({ q: path, limit: 1 }).catch(() => null),
    api.feedbackList().catch(() => []),
  ]);

  const meta = listRes?.items.find((i) => i.path === path);
  const fb = Array.isArray(feedbackRes) ? feedbackRes.find((f) => f.path === path) : null;

  if ('error' in fileRes) {
    return (
      <Shell>
        <Header path={path} meta={meta} />
        <div style={{ marginTop: 24, padding: 16, border: '1px solid var(--cm-border)', borderRadius: 10, background: 'var(--cm-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--cm-muted)' }}>
            <IconWarning /> Could not load file.
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: 'var(--cm-muted)' }}>{fileRes.error}</div>
        </div>
      </Shell>
    );
  }

  const content = fileRes.content ?? '';
  const lines = content.length === 0 ? [] : content.split('\n');
  const startLine = fileRes.start ?? 1;

  return (
    <Shell>
      <Header path={path} meta={meta} />

      <section style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 16 }}>
        <FeedbackForm path={path} initial={fb ? { ups: fb.ups, downs: fb.downs, boost: fb.boost } : null} />
        <TagEditor path={path} />

        <div style={{ border: '1px solid var(--cm-border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--cm-border)', background: 'var(--cm-subtle)' }}>
            <div style={{ fontSize: 13, color: 'var(--cm-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <IconFolder /> Lines {fileRes.start}-{fileRes.end}
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
              <Link href={`/related?path=${encodeURIComponent(path)}`} style={{ ...link, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                Related <IconArrowRight />
              </Link>
              <Link href="/sources" style={{ ...link, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                All sources <IconArrowRight />
              </Link>
            </div>
          </div>
          {lines.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--cm-muted)', fontSize: 14 }}>
              File is empty.
            </div>
          ) : (
            <pre style={{ margin: 0, padding: '14px 0', overflowX: 'auto', fontSize: 13, lineHeight: 1.55, fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)' }}>
              {lines.map((line, i) => (
                <div key={i} style={{ display: 'flex' }}>
                  <span style={{ flex: '0 0 56px', textAlign: 'right', paddingRight: 12, color: 'var(--cm-muted)', userSelect: 'none' }}>{startLine + i}</span>
                  <span style={{ whiteSpace: 'pre', paddingRight: 16 }}>{line || ' '}</span>
                </div>
              ))}
            </pre>
          )}
        </div>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh' }}>
      <TopNav />
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 24px 80px' }}>{children}</main>
    </div>
  );
}

function Header({ path, meta }: { path: string; meta?: { namespace: string; chunks: number; bytes: number; ingestedAt: number } | undefined }) {
  return (
    <header>
      <div style={{ fontSize: 12, color: 'var(--cm-muted)' }}>
        <Link href="/sources" style={link}>Sources</Link> / Source
      </div>
      <h1 style={{ ...h1, marginTop: 6, wordBreak: 'break-all' }}>{path}</h1>
      {meta && (
        <div style={{ ...muted, marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13 }}>
          <span>{meta.namespace}</span>
          <span>·</span>
          <span>{meta.chunks} chunks</span>
          <span>·</span>
          <span>{fmtBytes(meta.bytes)}</span>
          <span>·</span>
          <span>Updated {fmtRelative(meta.ingestedAt)}</span>
        </div>
      )}
    </header>
  );
}

const h1: React.CSSProperties = { fontSize: 24, fontWeight: 600, margin: 0, letterSpacing: -0.3 };
const muted: React.CSSProperties = { color: 'var(--cm-muted)' };
const link: React.CSSProperties = { color: 'var(--cm-accent)' };
