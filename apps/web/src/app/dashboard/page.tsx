import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, fmtBytes, fmtRelative } from '@/lib/api';
import { IconDatabase, IconChartBar, IconFolder, IconSpark, IconArrowRight, IconCheck, IconWarning } from '@clawmind/ui';

export const dynamic = 'force-dynamic';

type LoadResult = {
  health: Awaited<ReturnType<typeof api.health>> | null;
  stats: Awaited<ReturnType<typeof api.stats>> | null;
  history: Awaited<ReturnType<typeof api.history>>;
  sources: Awaited<ReturnType<typeof api.sourcesList>> | null;
  ingest: Awaited<ReturnType<typeof api.ingestStatus>> | null;
  doctor: Awaited<ReturnType<typeof api.doctor>> | null;
  errors: string[];
};

async function load(): Promise<LoadResult> {
  const errors: string[] = [];
  const safe = async <T,>(label: string, p: Promise<T>): Promise<T | null> => {
    try { return await p; } catch (e) { errors.push(`${label}: ${(e as Error).message}`); return null; }
  };
  const [health, stats, historyRes, sources, ingest, doctor] = await Promise.all([
    safe('health', api.health()),
    safe('stats', api.stats()),
    safe('history', api.history()),
    safe('sources', api.sourcesList({ limit: 5, sort: 'recent' })),
    safe('ingest', api.ingestStatus()),
    safe('doctor', api.doctor()),
  ]);
  return { health, stats, history: historyRes ?? [], sources, ingest, doctor, errors };
}

export default async function Dashboard() {
  const { health, stats, history, sources, ingest, doctor, errors } = await load();

  const totalDocs = stats?.totals.files ?? ingest?.documents ?? 0;
  const totalChunks = stats?.totals.chunks ?? ingest?.chunks ?? 0;
  const totalBytes = stats?.totals.bytes ?? 0;
  const namespaces = stats?.totals.namespaces ?? 0;

  const apiUp = !!health?.ok;

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopNav />
      <main style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 24px 80px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: -0.3 }}>Dashboard</h1>
            <p style={{ color: 'var(--cm-muted)', marginTop: 6, fontSize: 14 }}>
              A live look at the index, recent activity, and ingest health.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Link href="/chat" style={primaryBtn}>Ask a question</Link>
            <Link href="/ingest" style={ghostBtn}>Run ingest</Link>
          </div>
        </header>

        {!apiUp && (
          <div style={{ marginTop: 20, padding: 14, border: '1px solid var(--cm-border)', borderRadius: 10, background: 'var(--cm-subtle)', color: 'var(--cm-muted)', fontSize: 14 }}>
            The API at <code>{process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:7410'}</code> is not reachable.
            Start it with <code>pnpm --filter @clawmind/api dev</code>.
            {errors.length > 0 && <div style={{ marginTop: 6, fontSize: 12 }}>{errors.join(' · ')}</div>}
          </div>
        )}

        <section style={statGrid}>
          <StatCard icon={<IconFolder />} label="Documents" value={fmtNum(totalDocs)} sub={`${namespaces} namespaces`} />
          <StatCard icon={<IconDatabase />} label="Chunks" value={fmtNum(totalChunks)} sub="indexed segments" />
          <StatCard icon={<IconChartBar />} label="Storage" value={fmtBytes(totalBytes)} sub="of raw content" />
          <StatCard icon={<IconSpark />} label="Embeddings" value={health?.embed ? 'Ready' : 'Offline'} sub={health?.llm ? 'LLM ready' : 'LLM offline'} />
        </section>

        <section style={twoCol}>
          <Panel title="Recent questions" href="/history" linkLabel="All history">
            {history.length === 0 ? (
              <EmptyHint text="Nothing asked yet. Open chat to start." href="/chat" cta="Open chat" />
            ) : (
              <ul style={listReset}>
                {history.slice(0, 6).map((h) => (
                  <li key={h.id} style={rowItem}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.query}</div>
                      <div style={metaText}>{fmtRelative(h.ts)} · {h.model}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Freshly ingested" href="/sources" linkLabel="All sources">
            {!sources || sources.items.length === 0 ? (
              <EmptyHint text="No sources yet. Point the ingester at a folder." href="/ingest" cta="Run ingest" />
            ) : (
              <ul style={listReset}>
                {sources.items.map((s) => (
                  <li key={s.documentId} style={rowItem}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <a href={`/sources/view?path=${encodeURIComponent(s.path)}`} style={{ fontWeight: 500, fontSize: 14, color: 'var(--cm-fg)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}>
                        {s.path}
                      </a>
                      <div style={metaText}>{s.namespace} · {s.chunks} chunks · {fmtBytes(s.bytes)} · {fmtRelative(s.ingestedAt)}</div>
                    </div>
                    <a href={`/sources/view?path=${encodeURIComponent(s.path)}`} style={{ color: 'var(--cm-muted)', display: 'inline-flex', alignItems: 'center' }} aria-label="Open source">
                      <IconArrowRight />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </section>

        <section style={{ marginTop: 28 }}>
          <Panel title="Index health" href="/doctor" linkLabel="Open doctor">
            {!doctor ? (
              <EmptyHint text="Could not reach the doctor endpoint." href="/doctor" cta="Retry" />
            ) : doctor.findings.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--cm-muted)', fontSize: 14 }}>
                <IconCheck /> All stores in sync. {fmtNum(doctor.counts.manifestDocs)} files, {fmtNum(doctor.counts.manifestChunks)} chunks.
              </div>
            ) : (
              <ul style={listReset}>
                {topFindings(doctor.findings).map((f, i) => (
                  <li key={`${f.code}-${i}`} style={rowItem}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500 }}>
                        <IconWarning />
                        <span style={{ fontFamily: 'var(--cm-font-mono)', fontSize: 11, color: 'var(--cm-muted)' }}>{f.code}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.message}</span>
                      </div>
                    </div>
                    <Link href={`/doctor?focus=${encodeURIComponent(f.code)}`} style={{ color: 'var(--cm-muted)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                      Inspect <IconArrowRight />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </section>

        <section style={{ marginTop: 28 }}>
          <Panel title="Namespaces" href="/stats" linkLabel="Detailed stats">
            {!stats || stats.byNamespace.length === 0 ? (
              <EmptyHint text="No namespaces indexed yet." href="/ingest" cta="Ingest something" />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                {stats.byNamespace.slice(0, 8).map((n) => (
                  <div key={n.namespace} style={{ padding: 14, border: '1px solid var(--cm-border)', borderRadius: 10 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{n.namespace}</div>
                    <div style={{ ...metaText, marginTop: 4 }}>{n.files} files · {fmtNum(n.chunks)} chunks · {fmtBytes(n.bytes)}</div>
                    <div style={{ ...metaText, marginTop: 2 }}>Updated {fmtRelative(n.newestIngestedAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </section>
      </main>
    </div>
  );
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function topFindings(findings: { severity: 'info' | 'warn' | 'error'; code: string; message: string; hint?: string }[]) {
  const order: Record<string, number> = { error: 0, warn: 1, info: 2 };
  return [...findings].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9)).slice(0, 4);
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div style={{ padding: 16, border: '1px solid var(--cm-border)', borderRadius: 12, background: 'var(--cm-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--cm-muted)', fontSize: 12 }}>
        {icon}<span>{label}</span>
      </div>
      <div style={{ marginTop: 8, fontSize: 24, fontWeight: 600, letterSpacing: -0.3 }}>{value}</div>
      <div style={metaText}>{sub}</div>
    </div>
  );
}

function Panel({ title, href, linkLabel, children }: { title: string; href: string; linkLabel: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 18, border: '1px solid var(--cm-border)', borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{title}</h2>
        <Link href={href} style={{ fontSize: 13, color: 'var(--cm-muted)' }}>{linkLabel}</Link>
      </div>
      {children}
    </div>
  );
}

function EmptyHint({ text, href, cta }: { text: string; href: string; cta: string }) {
  return (
    <div style={{ padding: '24px 8px', textAlign: 'center', color: 'var(--cm-muted)', fontSize: 14 }}>
      <div>{text}</div>
      <Link href={href} style={{ ...ghostBtn, marginTop: 12, display: 'inline-block' }}>{cta}</Link>
    </div>
  );
}

const statGrid: React.CSSProperties = {
  marginTop: 28,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: 14,
};
const twoCol: React.CSSProperties = {
  marginTop: 28,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 16,
};
const listReset: React.CSSProperties = { listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 };
const rowItem: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  padding: '10px 12px', border: '1px solid var(--cm-border)', borderRadius: 8,
};
const metaText: React.CSSProperties = { fontSize: 12, color: 'var(--cm-muted)', marginTop: 2 };
const primaryBtn: React.CSSProperties = { padding: '8px 14px', background: 'var(--cm-accent)', color: 'white', borderRadius: 8, fontSize: 14, fontWeight: 500 };
const ghostBtn: React.CSSProperties = { padding: '8px 14px', border: '1px solid var(--cm-border)', borderRadius: 8, fontSize: 14, color: 'var(--cm-fg)' };
