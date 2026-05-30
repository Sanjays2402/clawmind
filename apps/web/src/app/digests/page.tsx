'use client';
import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, fmtRelative, type DigestSummary } from '@/lib/api';
import { EmptyState, ErrorState, Spinner, IconRefresh, IconCheck, IconBook } from '@clawmind/ui';

type Status = 'loading' | 'ok' | 'error' | 'empty';

export default function DigestsPage() {
  const [items, setItems] = useState<DigestSummary[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [lastRun, setLastRun] = useState<Record<string, { added: number; removed: number; ts: number } | undefined>>({});
  const [, start] = useTransition();

  async function reload() {
    setStatus('loading');
    setErr(null);
    try {
      const list = await api.digests();
      setItems(list);
      setStatus(list.length === 0 ? 'empty' : 'ok');
    } catch (e) {
      setErr((e as Error).message);
      setStatus('error');
    }
  }

  useEffect(() => { reload(); }, []);

  const run = (id: string) => {
    setRunning((s) => ({ ...s, [id]: true }));
    start(async () => {
      try {
        const res = await api.digestRun(id, 8);
        setLastRun((s) => ({ ...s, [id]: { added: res.entry.newSources.length, removed: res.entry.removedSources.length, ts: res.lastRunTs } }));
        // Refresh summary
        const list = await api.digests();
        setItems(list);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setRunning((s) => ({ ...s, [id]: false }));
      }
    });
  };

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopNav />
      <main style={{ maxWidth: 980, margin: '0 auto', padding: '28px 24px 80px' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, letterSpacing: -0.3 }}>Digests</h1>
            <p style={{ color: 'var(--cm-muted)', marginTop: 6, fontSize: 14 }}>
              Run saved searches on demand and see what changed since last time.
            </p>
          </div>
          <button onClick={reload} style={ghostBtn} aria-label="Refresh">
            <IconRefresh /> Refresh
          </button>
        </header>

        {status === 'loading' && (
          <div style={{ marginTop: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--cm-muted)' }}>
            <Spinner /> <span style={{ marginLeft: 8 }}>Loading digests...</span>
          </div>
        )}

        {status === 'error' && (
          <div style={{ marginTop: 24 }}>
            <ErrorState title="Could not load digests" message={err ?? 'Unknown error'} onRetry={reload} />
          </div>
        )}

        {status === 'empty' && (
          <div style={{ marginTop: 24 }}>
            <EmptyState
              icon={<IconBook />}
              title="No digests yet"
              body="Save a search first, then come back here to run digests against it."
            />
            <div style={{ marginTop: 12, textAlign: 'center' }}>
              <Link href="/saved" style={primaryBtn}>Go to saved searches</Link>
            </div>
          </div>
        )}

        {status === 'ok' && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '24px 0 0', display: 'grid', gap: 12 }}>
            {items.map((d) => {
              const last = lastRun[d.savedSearchId];
              return (
                <li key={d.savedSearchId} style={{ padding: 16, border: '1px solid var(--cm-border)', borderRadius: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{d.title || d.query}</div>
                      <div style={{ marginTop: 4, fontSize: 13, color: 'var(--cm-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {d.query}
                      </div>
                      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--cm-muted)' }}>
                        Last run {fmtRelative(d.lastRunTs)} · {d.runs} runs · +{d.lastNewCount} / -{d.lastRemovedCount}
                      </div>
                      {last && (
                        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--cm-fg)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <IconCheck /> Just ran: +{last.added} new, -{last.removed} removed
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <button
                        onClick={() => run(d.savedSearchId)}
                        disabled={running[d.savedSearchId]}
                        style={primaryBtn}
                      >
                        {running[d.savedSearchId] ? 'Running...' : 'Run now'}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}

const primaryBtn: React.CSSProperties = { padding: '8px 14px', background: 'var(--cm-accent)', color: 'white', borderRadius: 8, fontSize: 14, fontWeight: 500, border: 'none', cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--cm-border)', borderRadius: 8, fontSize: 13, color: 'var(--cm-fg)', background: 'transparent', cursor: 'pointer' };
