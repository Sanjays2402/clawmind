import type { Metadata } from 'next';
import { API_BASE } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Software Bill of Materials | ClawMind',
  description: 'CycloneDX 1.5 SBOM and supply-chain attestation.',
};

// Public SBOM landing page. Server-rendered so procurement reviewers
// (and their vulnerability-management tooling) see a real document
// without running JavaScript. The CycloneDX 1.5 JSON itself lives at
// /v1/sbom.json and is the URL a buyer pins in their SCA pipeline.
//
// Framework-light: no client components, no auth probing. Mirrors the
// trust-center surface so a reviewer who screenshots either page sees
// the same visual baseline.

interface SbomSummary {
  specVersion: string;
  format: string;
  components: { total: number; required: number; optional: number; workspace: number };
  attestation: {
    vendor: string;
    repository: string;
    commit: string;
    notes: string;
    signature: { hash: string; signedBy: string; signedAt: number; componentCount: number } | null;
  };
}

async function fetchSummary(): Promise<SbomSummary | null> {
  try {
    const r = await fetch(`${API_BASE}/v1/sbom/summary`, { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()) as SbomSummary;
  } catch {
    return null;
  }
}

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return '';
  try {
    return new Date(ms).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

function shortHash(h: string): string {
  if (!h) return '';
  return `${h.slice(0, 12)} ${h.slice(12, 24)}`;
}

export default async function SbomPage() {
  const summary = await fetchSummary();
  const sbomJsonUrl = `${API_BASE}/v1/sbom.json`;

  return (
    <main style={{ maxWidth: 880, margin: '60px auto', padding: '0 24px', lineHeight: 1.6 }}>
      <header style={{ borderBottom: '1px solid var(--cm-border, #e5e7eb)', paddingBottom: 24, marginBottom: 32 }}>
        <p style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--cm-muted)', margin: 0 }}>
          ClawMind
        </p>
        <h1 style={{ fontSize: 36, fontWeight: 700, margin: '6px 0 0' }}>Software Bill of Materials</h1>
        <p style={{ marginTop: 12, color: 'var(--cm-muted)', maxWidth: 640 }}>
          CycloneDX 1.5 inventory of every component built into this
          deployment. Generated at request time from the on-disk
          manifests so the document cannot drift from what actually
          runs in production.
        </p>
      </header>

      {!summary && (
        <section
          style={{
            border: '1px solid var(--cm-border, #e5e7eb)',
            borderRadius: 12,
            padding: '24px 28px',
            marginBottom: 32,
            background: 'var(--cm-surface, #fafafa)',
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>SBOM unavailable</h2>
          <p style={{ marginTop: 8, color: 'var(--cm-muted)' }}>
            The deployment is reachable but the API did not return a
            summary. Try the raw document at{' '}
            <a href={sbomJsonUrl} style={{ color: '#2563eb' }}>
              {sbomJsonUrl}
            </a>
            .
          </p>
        </section>
      )}

      {summary && (
        <>
          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 16,
              marginBottom: 32,
            }}
          >
            {[
              { label: 'Total components', value: summary.components.total },
              { label: 'Required', value: summary.components.required },
              { label: 'Optional', value: summary.components.optional },
              { label: 'Workspace', value: summary.components.workspace },
            ].map((card) => (
              <div
                key={card.label}
                style={{
                  border: '1px solid var(--cm-border, #e5e7eb)',
                  borderRadius: 12,
                  padding: '16px 18px',
                }}
              >
                <p style={{ margin: 0, fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--cm-muted)' }}>
                  {card.label}
                </p>
                <p style={{ margin: '6px 0 0', fontSize: 24, fontWeight: 600 }}>{card.value}</p>
              </div>
            ))}
          </section>

          <section
            style={{
              border: '1px solid var(--cm-border, #e5e7eb)',
              borderRadius: 12,
              padding: '24px 28px',
              marginBottom: 32,
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Attestation</h2>
            {!summary.attestation.vendor && !summary.attestation.repository && !summary.attestation.signature ? (
              <p style={{ marginTop: 8, color: 'var(--cm-muted)' }}>
                No vendor attestation has been published for this
                deployment. The component graph still reflects what
                runs in production.
              </p>
            ) : (
              <dl style={{ display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: 8, columnGap: 16, marginTop: 12 }}>
                {summary.attestation.vendor && (
                  <>
                    <dt style={{ color: 'var(--cm-muted)' }}>Vendor</dt>
                    <dd style={{ margin: 0 }}>{summary.attestation.vendor}</dd>
                  </>
                )}
                {summary.attestation.repository && (
                  <>
                    <dt style={{ color: 'var(--cm-muted)' }}>Repository</dt>
                    <dd style={{ margin: 0 }}>
                      <a href={summary.attestation.repository} style={{ color: '#2563eb' }}>
                        {summary.attestation.repository}
                      </a>
                    </dd>
                  </>
                )}
                {summary.attestation.commit && (
                  <>
                    <dt style={{ color: 'var(--cm-muted)' }}>Build commit</dt>
                    <dd style={{ margin: 0, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
                      {summary.attestation.commit}
                    </dd>
                  </>
                )}
                {summary.attestation.signature && (
                  <>
                    <dt style={{ color: 'var(--cm-muted)' }}>Signed</dt>
                    <dd style={{ margin: 0 }}>
                      {fmtDate(summary.attestation.signature.signedAt)} over{' '}
                      {summary.attestation.signature.componentCount} components
                    </dd>
                    <dt style={{ color: 'var(--cm-muted)' }}>Signature hash</dt>
                    <dd style={{ margin: 0, fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 13 }}>
                      {shortHash(summary.attestation.signature.hash)}
                    </dd>
                  </>
                )}
                {summary.attestation.notes && (
                  <>
                    <dt style={{ color: 'var(--cm-muted)' }}>Notes</dt>
                    <dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{summary.attestation.notes}</dd>
                  </>
                )}
              </dl>
            )}
          </section>

          <section
            style={{
              border: '1px solid var(--cm-border, #e5e7eb)',
              borderRadius: 12,
              padding: '24px 28px',
              marginBottom: 32,
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Download</h2>
            <p style={{ marginTop: 8, color: 'var(--cm-muted)' }}>
              Pin the URL below in your SCA pipeline (Anchore, Snyk,
              Dependency-Track). The {summary.format} {summary.specVersion}{' '}
              document is regenerated on every request from the
              on-disk manifests.
            </p>
            <p style={{ marginTop: 12 }}>
              <a
                href={sbomJsonUrl}
                style={{
                  display: 'inline-block',
                  padding: '10px 18px',
                  borderRadius: 8,
                  background: '#111827',
                  color: '#fff',
                  textDecoration: 'none',
                  fontWeight: 500,
                }}
              >
                Open sbom.json
              </a>
            </p>
          </section>
        </>
      )}

      <footer style={{ marginTop: 48, fontSize: 13, color: 'var(--cm-muted)' }}>
        Generated by the ClawMind API. No authentication is required
        to retrieve this page or the underlying SBOM document.
      </footer>
    </main>
  );
}
