import type { Metadata } from 'next';
import { API_BASE, type IncidentsPublicList, type IncidentPublic } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Security Incidents | ClawMind',
  description: 'Past security incidents, severity, scope, and resolution timeline.',
};

// Public security incident log. Server-rendered so vendor-review crawlers
// see a real document, not a JavaScript shell. Pulls from /v1/incidents
// which is the same JSON a buyer can ingest into their own questionnaire
// tooling. Deliberately framework-light, no auth probing, no analytics.

async function fetchList(): Promise<IncidentsPublicList | null> {
  try {
    const r = await fetch(`${API_BASE}/v1/incidents`, { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()) as IncidentsPublicList;
  } catch {
    return null;
  }
}

function sevColor(s: IncidentPublic['severity']): string {
  if (s === 'critical') return '#dc2626';
  if (s === 'high') return '#ea580c';
  if (s === 'medium') return '#ca8a04';
  return '#64748b';
}

function sevLabel(s: IncidentPublic['severity']): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function statusLabel(s: IncidentPublic['status']): string {
  if (s === 'investigating') return 'Investigating';
  if (s === 'identified') return 'Identified';
  if (s === 'monitoring') return 'Monitoring';
  return 'Resolved';
}

function statusColor(s: IncidentPublic['status']): string {
  if (s === 'resolved') return '#16a34a';
  if (s === 'monitoring') return '#0891b2';
  return '#ca8a04';
}

function fmt(ms: number | null): string {
  if (!ms) return '';
  try { return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; }
  catch { return ''; }
}

function duration(startedAt: number, resolvedAt: number | null): string {
  if (!resolvedAt) return 'ongoing';
  const ms = resolvedAt - startedAt;
  const mins = Math.max(1, Math.round(ms / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${d}d ${hh}h` : `${d}d`;
}

export default async function IncidentsPage() {
  const data = await fetchList();
  const incidents = data?.incidents ?? [];

  return (
    <main style={{ maxWidth: 880, margin: '60px auto', padding: '0 24px', lineHeight: 1.6 }}>
      <header style={{ borderBottom: '1px solid var(--cm-border, #e5e7eb)', paddingBottom: 24, marginBottom: 32 }}>
        <p style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--cm-muted)', margin: 0 }}>
          ClawMind
        </p>
        <h1 style={{ fontSize: 36, fontWeight: 700, margin: '6px 0 0' }}>Security Incidents</h1>
        <p style={{ marginTop: 12, color: 'var(--cm-muted)', maxWidth: 640 }}>
          Past security incidents affecting this workspace, with severity, customer data impact, and resolution timeline. Updated by the workspace owner.
        </p>
      </header>

      {!data && (
        <section style={{ padding: 24, border: '1px solid var(--cm-border, #e5e7eb)', borderRadius: 12 }}>
          <p style={{ margin: 0, color: 'var(--cm-muted)' }}>
            Incident log is unavailable right now. Try again in a moment.
          </p>
        </section>
      )}

      {data && incidents.length === 0 && (
        <section style={{ padding: 24, border: '1px solid var(--cm-border, #e5e7eb)', borderRadius: 12 }}>
          <p style={{ margin: 0, color: 'var(--cm-muted)' }}>
            No incidents have been disclosed for this workspace.
          </p>
        </section>
      )}

      {data && incidents.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 16 }}>
          {incidents.map((inc) => (
            <li
              key={inc.id}
              style={{
                padding: 20,
                border: '1px solid var(--cm-border, #e5e7eb)',
                borderRadius: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{inc.title}</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: sevColor(inc.severity), textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {sevLabel(inc.severity)}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: statusColor(inc.status), textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {statusLabel(inc.status)}
                  </span>
                </div>
              </div>

              {inc.summary?.trim() && (
                <p style={{ margin: '10px 0 0', color: 'var(--cm-fg)' }}>{inc.summary}</p>
              )}

              <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 200px) 1fr', gap: '6px 16px', margin: '14px 0 0', fontSize: 13 }}>
                <dt style={{ color: 'var(--cm-muted)' }}>Started</dt>
                <dd style={{ margin: 0 }}>{fmt(inc.startedAt)}</dd>
                <dt style={{ color: 'var(--cm-muted)' }}>Resolved</dt>
                <dd style={{ margin: 0 }}>{inc.resolvedAt ? fmt(inc.resolvedAt) : <span style={{ color: 'var(--cm-muted)' }}>Ongoing</span>}</dd>
                <dt style={{ color: 'var(--cm-muted)' }}>Duration</dt>
                <dd style={{ margin: 0 }}>{duration(inc.startedAt, inc.resolvedAt)}</dd>
                <dt style={{ color: 'var(--cm-muted)' }}>Customer data impacted</dt>
                <dd style={{ margin: 0, color: inc.customerDataImpacted ? '#dc2626' : 'var(--cm-fg)', fontWeight: inc.customerDataImpacted ? 600 : 400 }}>
                  {inc.customerDataImpacted ? 'Yes' : 'No'}
                </dd>
                {inc.affectedComponents.length > 0 && (
                  <>
                    <dt style={{ color: 'var(--cm-muted)' }}>Affected components</dt>
                    <dd style={{ margin: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {inc.affectedComponents.map((c) => (
                        <span key={c} style={{ fontSize: 12, padding: '2px 8px', border: '1px solid var(--cm-border, #e5e7eb)', borderRadius: 999 }}>
                          {c}
                        </span>
                      ))}
                    </dd>
                  </>
                )}
              </dl>

              {inc.updates.length > 0 && (
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--cm-border, #e5e7eb)' }}>
                  <div style={{ fontSize: 12, color: 'var(--cm-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    Timeline
                  </div>
                  <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                    {inc.updates.map((u, i) => (
                      <li key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 180px) 1fr', gap: 12, fontSize: 13 }}>
                        <span style={{ color: 'var(--cm-muted)' }}>
                          {fmt(u.at)} <span style={{ marginLeft: 6, color: statusColor(u.status) }}>{statusLabel(u.status)}</span>
                        </span>
                        <span>{u.message}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <footer style={{ marginTop: 40, color: 'var(--cm-muted)', fontSize: 12 }}>
        Machine-readable JSON: <code>{API_BASE}/v1/incidents</code>. See also the{' '}
        <a href="/trust">Trust Center</a>.
      </footer>
    </main>
  );
}
