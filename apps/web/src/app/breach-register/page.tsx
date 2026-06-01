import type { Metadata } from 'next';
import { API_BASE, type BreachRegisterPublic, type BreachPublic } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Personal Data Breach Register | ClawMind',
  description:
    'GDPR Article 33 and 34 personal data breach notification register for this ClawMind workspace.',
};

// Public regulatory artefact. Server-rendered so the buyer's DPO sees a
// real document, not a JavaScript shell. Pulls /v1/breach-register which
// is the same JSON shape they can ingest into their own register tooling,
// and links to /v1/breach-register.csv for a regulator-ready download.

async function fetchList(): Promise<BreachRegisterPublic | null> {
  try {
    const r = await fetch(`${API_BASE}/v1/breach-register`, { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()) as BreachRegisterPublic;
  } catch {
    return null;
  }
}

function sevColor(s: BreachPublic['severity']): string {
  if (s === 'critical') return '#dc2626';
  if (s === 'high') return '#ea580c';
  if (s === 'medium') return '#ca8a04';
  return '#64748b';
}
function sevLabel(s: BreachPublic['severity']): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function statusLabel(s: BreachPublic['status']): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function statusColor(s: BreachPublic['status']): string {
  if (s === 'closed') return '#16a34a';
  if (s === 'contained') return '#0891b2';
  return '#ca8a04';
}
function notifLabel(s: string): string {
  if (s === 'not_required') return 'Not required';
  if (s === 'pending') return 'Pending';
  if (s === 'notified') return 'Notified';
  if (s === 'delayed') return 'Delayed';
  if (s === 'public_communication') return 'Public communication';
  return s;
}
function notifColor(s: string): string {
  if (s === 'notified') return '#16a34a';
  if (s === 'not_required') return '#64748b';
  if (s === 'public_communication') return '#0891b2';
  if (s === 'delayed') return '#dc2626';
  return '#ca8a04';
}
function fmt(ms: number | null): string {
  if (!ms) return '';
  try { return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; }
  catch { return ''; }
}
function fmtCount(n: number | null): string {
  if (n === null || n === undefined) return 'Unknown';
  return n.toLocaleString('en-US');
}
function hoursTo(notifiedAt: number | null, discoveredAt: number): string {
  if (!notifiedAt) return '';
  const h = (notifiedAt - discoveredAt) / 3600_000;
  if (!Number.isFinite(h)) return '';
  if (h < 1) return '< 1 h';
  if (h < 100) return `${h.toFixed(1)} h`;
  return `${Math.round(h)} h`;
}

export default async function BreachRegisterPage() {
  const data = await fetchList();
  const entries = data?.entries ?? [];

  return (
    <main style={{ maxWidth: 920, margin: '60px auto', padding: '0 24px', lineHeight: 1.6 }}>
      <header style={{ borderBottom: '1px solid var(--cm-border, #e5e7eb)', paddingBottom: 24, marginBottom: 32 }}>
        <p style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--cm-muted)', margin: 0 }}>
          ClawMind / GDPR Art. 33 &amp; 34
        </p>
        <h1 style={{ fontSize: 36, fontWeight: 700, margin: '6px 0 0' }}>Personal Data Breach Register</h1>
        <p style={{ marginTop: 12, color: 'var(--cm-muted)', maxWidth: 680 }}>
          Per-workspace register of personal data breaches subject to Article 33 (notification to the supervisory authority within 72 hours) and Article 34 (notification to affected data subjects). Maintained by the workspace owner.
        </p>
        {data && (
          <div style={{ marginTop: 18, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <span style={pill}>{data.totalCount} total</span>
            <span style={pill}>{data.openCount} open</span>
            <span style={{ ...pill, color: data.overdueCount > 0 ? '#dc2626' : 'var(--cm-fg)', borderColor: data.overdueCount > 0 ? '#fecaca' : undefined }}>
              {data.overdueCount} past Art. 33 window
            </span>
          </div>
        )}
      </header>

      {!data && (
        <section style={card}>
          <p style={{ margin: 0, color: 'var(--cm-muted)' }}>
            Breach register is unavailable right now. Try again in a moment.
          </p>
        </section>
      )}

      {data && entries.length === 0 && (
        <section style={card}>
          <p style={{ margin: 0, color: 'var(--cm-muted)' }}>
            No notifiable personal data breaches have been recorded for this workspace.
          </p>
        </section>
      )}

      {data && entries.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 16 }}>
          {entries.map((e) => (
            <li key={e.id} style={card}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <span style={{ fontSize: 12, color: 'var(--cm-muted)' }}>{e.reference}</span>
                  <h2 style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 600 }}>{e.title}</h2>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={tagStyle(sevColor(e.severity))}>{sevLabel(e.severity)}</span>
                  <span style={tagStyle(statusColor(e.status))}>{statusLabel(e.status)}</span>
                  {e.withinArt33Window === false && (
                    <span style={tagStyle('#dc2626')}>Past 72 h</span>
                  )}
                </div>
              </div>

              {e.summary?.trim() && (
                <p style={{ margin: '10px 0 0', color: 'var(--cm-fg)' }}>{e.summary}</p>
              )}

              <dl style={dlStyle}>
                <dt style={dtStyle}>Discovered</dt>
                <dd style={ddStyle}>{fmt(e.discoveredAt)}</dd>
                {e.occurredAt && (
                  <>
                    <dt style={dtStyle}>Occurred</dt>
                    <dd style={ddStyle}>{fmt(e.occurredAt)}</dd>
                  </>
                )}
                {e.containedAt && (
                  <>
                    <dt style={dtStyle}>Contained</dt>
                    <dd style={ddStyle}>{fmt(e.containedAt)}</dd>
                  </>
                )}
                {e.closedAt && (
                  <>
                    <dt style={dtStyle}>Closed</dt>
                    <dd style={ddStyle}>{fmt(e.closedAt)}</dd>
                  </>
                )}
                <dt style={dtStyle}>Data categories</dt>
                <dd style={ddStyle}>{e.dataCategories}</dd>
                <dt style={dtStyle}>Data subjects</dt>
                <dd style={ddStyle}>{e.dataSubjects}</dd>
                <dt style={dtStyle}>Approx. records</dt>
                <dd style={ddStyle}>{fmtCount(e.approxRecords)}</dd>
                <dt style={dtStyle}>Approx. subjects</dt>
                <dd style={ddStyle}>{fmtCount(e.approxSubjects)}</dd>
                <dt style={dtStyle}>Likely consequences</dt>
                <dd style={ddStyle}>{e.likelyConsequences}</dd>
                <dt style={dtStyle}>Mitigations</dt>
                <dd style={ddStyle}>{e.mitigations}</dd>
              </dl>

              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--cm-border, #e5e7eb)', display: 'grid', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--cm-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Notification status
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 240px) 1fr', gap: '6px 16px', fontSize: 13 }}>
                  <span style={{ color: 'var(--cm-muted)' }}>Supervisory authority</span>
                  <span>
                    <span style={{ color: notifColor(e.authorityNotification), fontWeight: 600 }}>
                      {notifLabel(e.authorityNotification)}
                    </span>
                    {e.authorityName && <span style={{ color: 'var(--cm-muted)' }}> · {e.authorityName}</span>}
                    {e.authorityNotifiedAt && (
                      <span style={{ color: 'var(--cm-muted)' }}>
                        {' '}· {fmt(e.authorityNotifiedAt)} ({hoursTo(e.authorityNotifiedAt, e.discoveredAt)} after discovery)
                      </span>
                    )}
                  </span>
                  <span style={{ color: 'var(--cm-muted)' }}>Data subjects (Art. 34)</span>
                  <span>
                    <span style={{ color: notifColor(e.subjectNotification), fontWeight: 600 }}>
                      {notifLabel(e.subjectNotification)}
                    </span>
                    {e.subjectNotifiedAt && (
                      <span style={{ color: 'var(--cm-muted)' }}> · {fmt(e.subjectNotifiedAt)}</span>
                    )}
                  </span>
                  {e.delayJustification && (
                    <>
                      <span style={{ color: 'var(--cm-muted)' }}>Delay justification</span>
                      <span>{e.delayJustification}</span>
                    </>
                  )}
                  {e.contact && (
                    <>
                      <span style={{ color: 'var(--cm-muted)' }}>Contact</span>
                      <span><a href={`mailto:${e.contact}`}>{e.contact}</a></span>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer style={{ marginTop: 40, color: 'var(--cm-muted)', fontSize: 12 }}>
        Machine-readable JSON: <code>{API_BASE}/v1/breach-register</code>.
        {' '}CSV export: <a href={`${API_BASE}/v1/breach-register.csv`}>breach-register.csv</a>.
        {' '}See also the <a href="/incidents">Security Incident Log</a> and{' '}
        <a href="/trust">Trust Center</a>.
      </footer>
    </main>
  );
}

const card: React.CSSProperties = {
  padding: 20,
  border: '1px solid var(--cm-border, #e5e7eb)',
  borderRadius: 12,
};
const pill: React.CSSProperties = {
  fontSize: 12,
  padding: '4px 10px',
  border: '1px solid var(--cm-border, #e5e7eb)',
  borderRadius: 999,
  color: 'var(--cm-fg)',
};
const dlStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(160px, 200px) 1fr',
  gap: '6px 16px',
  margin: '14px 0 0',
  fontSize: 13,
};
const dtStyle: React.CSSProperties = { color: 'var(--cm-muted)' };
const ddStyle: React.CSSProperties = { margin: 0 };

function tagStyle(color: string): React.CSSProperties {
  return {
    fontSize: 11,
    fontWeight: 600,
    color,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    padding: '3px 8px',
    border: `1px solid ${color}33`,
    borderRadius: 6,
  };
}
