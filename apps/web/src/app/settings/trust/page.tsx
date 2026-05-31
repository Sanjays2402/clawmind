'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  type TrustProfile,
  type ComplianceFramework,
  type ComplianceStatus,
  type TrustLink,
} from '@/lib/api';
import { ErrorState, Spinner, IconCheck, IconPlus, IconRefresh, IconShield, IconTrash, IconWarning } from '@clawmind/ui';

// Owner-only Trust Center editor. The unauthenticated public projection
// at /trust is what procurement reviewers actually see; this page is the
// admin console that produces it. Every save round-trips through PUT
// /v1/trust, which requires owner role and MFA step-up at the API.

const STATUSES: { value: ComplianceStatus; label: string }[] = [
  { value: 'achieved', label: 'Achieved' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'not_pursued', label: 'Not pursued' },
];

function fmtDate(ts: number): string {
  if (!ts) return 'never';
  try { return new Date(ts).toISOString().slice(0, 16).replace('T', ' '); } catch { return 'unknown'; }
}

export default function TrustSettingsPage() {
  const [profile, setProfile] = useState<TrustProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await api.trustAdmin();
      setProfile(p);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You need admin or owner access to view the Trust Center.');
      } else if (err instanceof ApiError && err.status === 401) {
        setError('Sign in to view the Trust Center.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load trust profile.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const update = useCallback(<K extends keyof TrustProfile>(key: K, value: TrustProfile[K]) => {
    setProfile((p) => (p ? { ...p, [key]: value } : p));
    setSavedAt(null);
  }, []);

  const save = useCallback(async () => {
    if (!profile) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const next = await api.trustUpdate({
        summary: profile.summary,
        securityContactEmail: profile.securityContactEmail,
        vulnerabilityPolicyUrl: profile.vulnerabilityPolicyUrl,
        frameworks: profile.frameworks,
        encryptionAtRest: profile.encryptionAtRest,
        encryptionInTransit: profile.encryptionInTransit,
        dataResidency: profile.dataResidency,
        links: profile.links,
      });
      setProfile(next);
      setSavedAt(Date.now());
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) setActionError('Sign in to save.');
        else if (err.status === 403) setActionError('Owner role with MFA is required to save.');
        else if (err.status === 400) setActionError(`Validation error: ${err.message}`);
        else setActionError(err.message);
      } else {
        setActionError(err instanceof Error ? err.message : 'Save failed.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [profile]);

  const addFramework = useCallback(() => {
    setProfile((p) => p ? { ...p, frameworks: [...p.frameworks, { name: '', status: 'in_progress', issuedAt: null, auditor: null, reportUrl: null }] } : p);
    setSavedAt(null);
  }, []);

  const removeFramework = useCallback((idx: number) => {
    setProfile((p) => p ? { ...p, frameworks: p.frameworks.filter((_, i) => i !== idx) } : p);
    setSavedAt(null);
  }, []);

  const patchFramework = useCallback((idx: number, patch: Partial<ComplianceFramework>) => {
    setProfile((p) => p ? { ...p, frameworks: p.frameworks.map((f, i) => i === idx ? { ...f, ...patch } : f) } : p);
    setSavedAt(null);
  }, []);

  const addLink = useCallback(() => {
    setProfile((p) => p ? { ...p, links: [...p.links, { label: '', url: '' }] } : p);
    setSavedAt(null);
  }, []);

  const removeLink = useCallback((idx: number) => {
    setProfile((p) => p ? { ...p, links: p.links.filter((_, i) => i !== idx) } : p);
    setSavedAt(null);
  }, []);

  const patchLink = useCallback((idx: number, patch: Partial<TrustLink>) => {
    setProfile((p) => p ? { ...p, links: p.links.map((l, i) => i === idx ? { ...l, ...patch } : l) } : p);
    setSavedAt(null);
  }, []);

  const publicHref = useMemo(() => '/trust', []);

  return (
    <>
      <TopNav />
      <main style={{ maxWidth: 880, margin: '40px auto', padding: '0 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <IconShield size={22} />
              <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Trust Center</h1>
            </div>
            <p style={{ color: 'var(--cm-muted)', margin: '6px 0 0' }}>
              Edit the public page that procurement and security reviewers will see.
              <Link href={publicHref} style={{ marginLeft: 8 }}>View public page</Link>
            </p>
          </div>
          <button
            onClick={() => void load()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', border: '1px solid var(--cm-border, #e5e7eb)', borderRadius: 8, background: 'transparent', cursor: 'pointer' }}
          >
            <IconRefresh size={16} /> Refresh
          </button>
        </div>

        {loading && (
          <div style={{ padding: 40, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--cm-muted)' }}>
            <Spinner /> Loading trust profile...
          </div>
        )}

        {error && !loading && <ErrorState message={error} />}

        {profile && !loading && !error && (
          <form
            onSubmit={(e) => { e.preventDefault(); void save(); }}
            style={{ marginTop: 24, display: 'grid', gap: 24 }}
          >
            <Field label="Summary" hint="Plain text shown at the top of the public page.">
              <textarea
                value={profile.summary}
                onChange={(e) => update('summary', e.target.value)}
                rows={4}
                maxLength={4000}
                style={inputStyle}
                placeholder="One paragraph that describes your security posture."
              />
            </Field>

            <Field label="Security contact email">
              <input
                type="email"
                value={profile.securityContactEmail ?? ''}
                onChange={(e) => update('securityContactEmail', e.target.value || null)}
                maxLength={320}
                style={inputStyle}
                placeholder="security@example.com"
              />
            </Field>

            <Field label="Vulnerability disclosure policy URL">
              <input
                type="url"
                value={profile.vulnerabilityPolicyUrl ?? ''}
                onChange={(e) => update('vulnerabilityPolicyUrl', e.target.value || null)}
                maxLength={500}
                style={inputStyle}
                placeholder="https://example.com/security/disclosure"
              />
            </Field>

            <Field label="Encryption at rest">
              <input
                value={profile.encryptionAtRest ?? ''}
                onChange={(e) => update('encryptionAtRest', e.target.value || null)}
                maxLength={500}
                style={inputStyle}
                placeholder="AES-256 at the storage layer"
              />
            </Field>

            <Field label="Encryption in transit">
              <input
                value={profile.encryptionInTransit ?? ''}
                onChange={(e) => update('encryptionInTransit', e.target.value || null)}
                maxLength={500}
                style={inputStyle}
                placeholder="TLS 1.3 for every public endpoint"
              />
            </Field>

            <Field label="Data residency">
              <input
                value={profile.dataResidency ?? ''}
                onChange={(e) => update('dataResidency', e.target.value || null)}
                maxLength={500}
                style={inputStyle}
                placeholder="us-east-1 by default; EU residency available on request"
              />
            </Field>

            <section>
              <div style={sectionHeader}>
                <span>Compliance frameworks ({profile.frameworks.length})</span>
                <button type="button" onClick={addFramework} style={smallButton}>
                  <IconPlus size={14} /> Add
                </button>
              </div>
              {profile.frameworks.length === 0 && (
                <p style={{ color: 'var(--cm-muted)', margin: '8px 0 0' }}>No frameworks yet.</p>
              )}
              {profile.frameworks.map((f, i) => (
                <div key={i} style={cardStyle}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                    <input value={f.name} onChange={(e) => patchFramework(i, { name: e.target.value })} placeholder="SOC 2 Type II" style={inputStyle} maxLength={120} />
                    <select value={f.status} onChange={(e) => patchFramework(i, { status: e.target.value as ComplianceStatus })} style={inputStyle}>
                      {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                    <input type="date" value={f.issuedAt ?? ''} onChange={(e) => patchFramework(i, { issuedAt: e.target.value || null })} style={inputStyle} />
                    <input value={f.auditor ?? ''} onChange={(e) => patchFramework(i, { auditor: e.target.value || null })} placeholder="Auditor" style={inputStyle} maxLength={200} />
                    <input type="url" value={f.reportUrl ?? ''} onChange={(e) => patchFramework(i, { reportUrl: e.target.value || null })} placeholder="Report URL" style={inputStyle} maxLength={500} />
                  </div>
                  <button type="button" onClick={() => removeFramework(i)} style={{ ...smallButton, marginTop: 8 }} aria-label="Remove framework">
                    <IconTrash size={14} /> Remove
                  </button>
                </div>
              ))}
            </section>

            <section>
              <div style={sectionHeader}>
                <span>Additional links ({profile.links.length})</span>
                <button type="button" onClick={addLink} style={smallButton}>
                  <IconPlus size={14} /> Add
                </button>
              </div>
              {profile.links.length === 0 && (
                <p style={{ color: 'var(--cm-muted)', margin: '8px 0 0' }}>No links yet.</p>
              )}
              {profile.links.map((l, i) => (
                <div key={i} style={cardStyle}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) 2fr', gap: 12 }}>
                    <input value={l.label} onChange={(e) => patchLink(i, { label: e.target.value })} placeholder="Privacy Policy" style={inputStyle} maxLength={80} />
                    <input type="url" value={l.url} onChange={(e) => patchLink(i, { url: e.target.value })} placeholder="https://example.com/privacy" style={inputStyle} maxLength={500} />
                  </div>
                  <button type="button" onClick={() => removeLink(i)} style={{ ...smallButton, marginTop: 8 }} aria-label="Remove link">
                    <IconTrash size={14} /> Remove
                  </button>
                </div>
              ))}
            </section>

            {actionError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#b91c1c' }}>
                <IconWarning size={16} /> {actionError}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                type="submit"
                disabled={submitting}
                style={{ padding: '10px 16px', borderRadius: 8, background: '#111827', color: 'white', border: 'none', cursor: submitting ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                {submitting ? <Spinner /> : <IconCheck size={16} />}
                {submitting ? 'Saving...' : 'Save trust profile'}
              </button>
              {savedAt && (
                <span style={{ color: 'var(--cm-muted)', fontSize: 13 }}>
                  Saved at {new Date(savedAt).toISOString().slice(11, 19)}
                </span>
              )}
              <span style={{ color: 'var(--cm-muted)', fontSize: 13, marginLeft: 'auto' }}>
                Last updated {fmtDate(profile.updatedAt)}{profile.updatedBy ? ` by ${profile.updatedBy}` : ''}
              </span>
            </div>
          </form>
        )}
      </main>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--cm-border, #e5e7eb)',
  borderRadius: 8,
  background: 'var(--cm-bg, white)',
  color: 'inherit',
  fontSize: 14,
  width: '100%',
  fontFamily: 'inherit',
};

const cardStyle: React.CSSProperties = {
  padding: 12,
  border: '1px solid var(--cm-border, #e5e7eb)',
  borderRadius: 10,
  marginTop: 12,
};

const sectionHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--cm-muted)',
};

const smallButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  border: '1px solid var(--cm-border, #e5e7eb)',
  borderRadius: 8,
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 13,
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      {hint && <span style={{ fontSize: 12, color: 'var(--cm-muted)' }}>{hint}</span>}
      {children}
    </label>
  );
}
