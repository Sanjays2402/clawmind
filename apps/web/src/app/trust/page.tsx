import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { API_BASE, type TrustPublicProfile } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Trust Center | ClawMind',
  description: 'Security, compliance, and data handling at a glance.',
};

// Public trust page. Server-rendered so vendor-review crawlers see a
// real document, not a JavaScript shell. Pulls from /v1/trust which is
// the same JSON a buyer can ingest into their own questionnaire tooling.
//
// Deliberately framework-light: no client components, no auth probing,
// no analytics calls. Procurement reviewers screenshot this; the fewer
// network requests, the cleaner the screenshot.

async function fetchProfile(): Promise<TrustPublicProfile | null> {
  try {
    const h = await headers();
    const forwarded = h.get('x-forwarded-host');
    void forwarded; // reserved for multi-tenant routing
    const r = await fetch(`${API_BASE}/v1/trust`, { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()) as TrustPublicProfile;
  } catch {
    return null;
  }
}

function statusLabel(s: string): string {
  if (s === 'achieved') return 'Achieved';
  if (s === 'in_progress') return 'In progress';
  return 'Not pursued';
}

function statusColor(s: string): string {
  if (s === 'achieved') return '#16a34a';
  if (s === 'in_progress') return '#ca8a04';
  return 'var(--cm-muted)';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  try { return new Date(iso).toISOString().slice(0, 10); } catch { return iso; }
}

export default async function TrustCenterPage() {
  const profile = await fetchProfile();

  return (
    <main style={{ maxWidth: 880, margin: '60px auto', padding: '0 24px', lineHeight: 1.6 }}>
      <header style={{ borderBottom: '1px solid var(--cm-border, #e5e7eb)', paddingBottom: 24, marginBottom: 32 }}>
        <p style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--cm-muted)', margin: 0 }}>
          ClawMind
        </p>
        <h1 style={{ fontSize: 36, fontWeight: 700, margin: '6px 0 0' }}>Trust Center</h1>
        <p style={{ marginTop: 12, color: 'var(--cm-muted)', maxWidth: 640 }}>
          {profile?.summary?.trim()
            ? profile.summary
            : 'Security posture, compliance status, and data handling for this workspace. Updated by the workspace owner.'}
        </p>
      </header>

      {!profile && (
        <section style={{ padding: 24, border: '1px solid var(--cm-border, #e5e7eb)', borderRadius: 12 }}>
          <p style={{ margin: 0, color: 'var(--cm-muted)' }}>
            Trust profile is unavailable right now. Try again in a moment, or contact the workspace owner.
          </p>
        </section>
      )}

      {profile && (
        <>
          <Section title="Compliance">
            {profile.frameworks.length === 0 ? (
              <EmptyNote>No compliance frameworks have been published yet.</EmptyNote>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
                {profile.frameworks.map((f, i) => (
                  <li
                    key={i}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 16,
                      padding: 16,
                      border: '1px solid var(--cm-border, #e5e7eb)',
                      borderRadius: 10,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ minWidth: 200 }}>
                      <div style={{ fontWeight: 600 }}>{f.name}</div>
                      {f.auditor && (
                        <div style={{ color: 'var(--cm-muted)', fontSize: 13 }}>Auditor: {f.auditor}</div>
                      )}
                      {f.issuedAt && (
                        <div style={{ color: 'var(--cm-muted)', fontSize: 13 }}>Issued: {fmtDate(f.issuedAt)}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <span style={{ color: statusColor(f.status), fontSize: 13, fontWeight: 600 }}>
                        {statusLabel(f.status)}
                      </span>
                      {f.reportUrl && (
                        <a href={f.reportUrl} style={{ fontSize: 13 }} rel="noopener noreferrer" target="_blank">
                          Report
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Data handling">
            <Fact label="Encryption at rest" value={profile.encryptionAtRest} />
            <Fact label="Encryption in transit" value={profile.encryptionInTransit} />
            <Fact label="Data residency" value={profile.dataResidency} />
          </Section>

          <Section title="Security contact">
            {profile.securityContactEmail ? (
              <p style={{ margin: 0 }}>
                Report a vulnerability:{' '}
                <a href={`mailto:${profile.securityContactEmail}`}>{profile.securityContactEmail}</a>
              </p>
            ) : (
              <EmptyNote>No security contact has been published.</EmptyNote>
            )}
            {profile.vulnerabilityPolicyUrl && (
              <p style={{ margin: '8px 0 0' }}>
                Disclosure policy:{' '}
                <a href={profile.vulnerabilityPolicyUrl} rel="noopener noreferrer" target="_blank">
                  {profile.vulnerabilityPolicyUrl}
                </a>
              </p>
            )}
            <p style={{ margin: '8px 0 0', color: 'var(--cm-muted)', fontSize: 13 }}>
              Machine-readable contact at{' '}
              <a href="/.well-known/security.txt">/.well-known/security.txt</a>.
            </p>
          </Section>

          {profile.links.length > 0 && (
            <Section title="Resources">
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                {profile.links.map((l, i) => (
                  <li key={i}>
                    <a href={l.url} rel="noopener noreferrer" target="_blank">{l.label}</a>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <footer style={{ marginTop: 40, color: 'var(--cm-muted)', fontSize: 12 }}>
            Profile last updated {new Date(profile.updatedAt).toISOString().slice(0, 10)}.
            Machine-readable JSON: <code>{API_BASE}/v1/trust</code>.
          </footer>
        </>
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--cm-muted)', margin: '0 0 12px' }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 220px) 1fr', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--cm-border, #e5e7eb)' }}>
      <div style={{ color: 'var(--cm-muted)', fontSize: 14 }}>{label}</div>
      <div style={{ fontSize: 14 }}>{value?.trim() ? value : <span style={{ color: 'var(--cm-muted)' }}>Not specified</span>}</div>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: 0, color: 'var(--cm-muted)' }}>{children}</p>;
}
