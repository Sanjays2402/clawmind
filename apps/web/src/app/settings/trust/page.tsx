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
import {
  ErrorState,
  SettingsCardSkeleton,
  Spinner,
  IconArrowRight,
  IconCheck,
  IconPlus,
  IconRefresh,
  IconShield,
  IconTrash,
  IconWarning,
} from '@clawmind/ui';

// Owner-only Trust Center editor. The unauthenticated public projection
// at /trust is what procurement reviewers actually see; this page is the
// admin console that produces it. Every save round-trips through PUT
// /v1/trust, which requires owner role and MFA step-up at the API.

// Shared control styling: theme-aware surface + brand focus ring.
const INPUT_CLS =
  'w-full rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm text-cm-fg outline-none placeholder:text-cm-faint focus:ring-2 focus:ring-cm-accent';

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

  // Compliance posture from the live framework list. achieved certs are the
  // headline a buyer wants -> success; otherwise in-progress work -> cite;
  // an empty list -> muted prompt to add the first framework.
  const achievedCount = useMemo(
    () => profile?.frameworks.filter((f) => f.status === 'achieved' && f.name.trim()).length ?? 0,
    [profile],
  );
  const inProgressCount = useMemo(
    () => profile?.frameworks.filter((f) => f.status === 'in_progress' && f.name.trim()).length ?? 0,
    [profile],
  );

  return (
    <div className="min-h-screen bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-4 flex items-center gap-2 text-sm text-cm-muted">
          <Link href="/settings" className="hover:text-cm-fg">Settings</Link>
          <IconArrowRight size={14} />
          <span className="text-cm-fg">Trust Center</span>
        </div>

        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <IconShield size={24} /> Trust Center
            </h1>
            <p className="mt-1 text-sm text-cm-muted">
              Edit the public page that procurement and security reviewers will see.{' '}
              <Link href="/trust" className="text-cm-accent hover:underline">
                View public page
              </Link>
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-md border border-cm-border px-3 py-1.5 text-sm hover:bg-cm-subtle"
          >
            <IconRefresh size={16} /> Refresh
          </button>
        </div>

        {loading ? (
          <SettingsCardSkeleton rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : profile ? (
          <form
            onSubmit={(e) => { e.preventDefault(); void save(); }}
            className="mt-2 grid gap-6"
          >
            {/* Compliance posture: the headline a reviewer scans for. */}
            {achievedCount > 0 ? (
              <div className="flex items-start gap-2 rounded-md border border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] p-3 text-xs text-cm-success">
                <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {achievedCount} {achievedCount === 1 ? 'framework is' : 'frameworks are'} marked
                  achieved{inProgressCount > 0 ? `, ${inProgressCount} in progress` : ''}. This is
                  what a buyer sees first on the public Trust Center.
                </span>
              </div>
            ) : inProgressCount > 0 ? (
              <div className="flex items-start gap-2 rounded-md border border-cm-cite-line bg-cm-cite-bg p-3 text-xs text-cm-cite">
                <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {inProgressCount} {inProgressCount === 1 ? 'framework is' : 'frameworks are'} in
                  progress and none are achieved yet. The public page will show effort underway but
                  no certification.
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-cm-border bg-cm-subtle p-3 text-xs text-cm-muted">
                <IconShield className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  No compliance frameworks listed yet. Add SOC 2, ISO 27001, or whichever apply so a
                  reviewer can see your posture at a glance.
                </span>
              </div>
            )}

            <Field label="Summary" hint="Plain text shown at the top of the public page.">
              <textarea
                value={profile.summary}
                onChange={(e) => update('summary', e.target.value)}
                rows={4}
                maxLength={4000}
                className={`${INPUT_CLS} resize-y`}
                placeholder="One paragraph that describes your security posture."
              />
            </Field>

            <Field label="Security contact email">
              <input
                type="email"
                value={profile.securityContactEmail ?? ''}
                onChange={(e) => update('securityContactEmail', e.target.value || null)}
                maxLength={320}
                className={INPUT_CLS}
                placeholder="security@example.com"
              />
            </Field>

            <Field label="Vulnerability disclosure policy URL">
              <input
                type="url"
                value={profile.vulnerabilityPolicyUrl ?? ''}
                onChange={(e) => update('vulnerabilityPolicyUrl', e.target.value || null)}
                maxLength={500}
                className={INPUT_CLS}
                placeholder="https://example.com/security/disclosure"
              />
            </Field>

            <Field label="Encryption at rest">
              <input
                value={profile.encryptionAtRest ?? ''}
                onChange={(e) => update('encryptionAtRest', e.target.value || null)}
                maxLength={500}
                className={INPUT_CLS}
                placeholder="AES-256 at the storage layer"
              />
            </Field>

            <Field label="Encryption in transit">
              <input
                value={profile.encryptionInTransit ?? ''}
                onChange={(e) => update('encryptionInTransit', e.target.value || null)}
                maxLength={500}
                className={INPUT_CLS}
                placeholder="TLS 1.3 for every public endpoint"
              />
            </Field>

            <Field label="Data residency">
              <input
                value={profile.dataResidency ?? ''}
                onChange={(e) => update('dataResidency', e.target.value || null)}
                maxLength={500}
                className={INPUT_CLS}
                placeholder="us-east-1 by default; EU residency available on request"
              />
            </Field>

            <section>
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-cm-muted">
                <span>Compliance frameworks ({profile.frameworks.length})</span>
                <button type="button" onClick={addFramework} className={SMALL_BTN}>
                  <IconPlus size={14} /> Add
                </button>
              </div>
              {profile.frameworks.length === 0 && (
                <p className="mt-2 text-sm text-cm-muted">No frameworks yet.</p>
              )}
              {profile.frameworks.map((f, i) => {
                const tone =
                  f.status === 'achieved'
                    ? 'border-l-[var(--cm-success)]'
                    : f.status === 'in_progress'
                      ? 'border-l-cm-cite-line'
                      : 'border-l-cm-border';
                return (
                  <div
                    key={i}
                    className={`mt-3 rounded-lg border border-cm-border border-l-4 ${tone} bg-cm-paper p-3`}
                  >
                    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
                      <input value={f.name} onChange={(e) => patchFramework(i, { name: e.target.value })} placeholder="SOC 2 Type II" className={INPUT_CLS} maxLength={120} />
                      <select value={f.status} onChange={(e) => patchFramework(i, { status: e.target.value as ComplianceStatus })} className={INPUT_CLS}>
                        {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                      <input type="date" value={f.issuedAt ?? ''} onChange={(e) => patchFramework(i, { issuedAt: e.target.value || null })} className={INPUT_CLS} />
                      <input value={f.auditor ?? ''} onChange={(e) => patchFramework(i, { auditor: e.target.value || null })} placeholder="Auditor" className={INPUT_CLS} maxLength={200} />
                      <input type="url" value={f.reportUrl ?? ''} onChange={(e) => patchFramework(i, { reportUrl: e.target.value || null })} placeholder="Report URL" className={INPUT_CLS} maxLength={500} />
                    </div>
                    <button type="button" onClick={() => removeFramework(i)} className={`${SMALL_BTN} mt-2 text-cm-danger hover:bg-[rgba(180,66,60,0.10)]`} aria-label="Remove framework">
                      <IconTrash size={14} /> Remove
                    </button>
                  </div>
                );
              })}
            </section>

            <section>
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-cm-muted">
                <span>Additional links ({profile.links.length})</span>
                <button type="button" onClick={addLink} className={SMALL_BTN}>
                  <IconPlus size={14} /> Add
                </button>
              </div>
              {profile.links.length === 0 && (
                <p className="mt-2 text-sm text-cm-muted">No links yet.</p>
              )}
              {profile.links.map((l, i) => (
                <div key={i} className="mt-3 rounded-lg border border-cm-border bg-cm-paper p-3">
                  <div className="grid gap-3 [grid-template-columns:minmax(160px,1fr)_2fr]">
                    <input value={l.label} onChange={(e) => patchLink(i, { label: e.target.value })} placeholder="Privacy Policy" className={INPUT_CLS} maxLength={80} />
                    <input type="url" value={l.url} onChange={(e) => patchLink(i, { url: e.target.value })} placeholder="https://example.com/privacy" className={INPUT_CLS} maxLength={500} />
                  </div>
                  <button type="button" onClick={() => removeLink(i)} className={`${SMALL_BTN} mt-2 text-cm-danger hover:bg-[rgba(180,66,60,0.10)]`} aria-label="Remove link">
                    <IconTrash size={14} /> Remove
                  </button>
                </div>
              ))}
            </section>

            {actionError && (
              <div className="flex items-start gap-2 rounded-md border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] p-3 text-sm text-cm-danger">
                <IconWarning size={16} /> {actionError}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-md bg-cm-fg px-4 py-2 text-sm font-medium text-cm-bg hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? <Spinner /> : <IconCheck size={16} />}
                {submitting ? 'Saving...' : 'Save trust profile'}
              </button>
              {savedAt && (
                <span className="inline-flex items-center gap-1 text-xs text-cm-success">
                  <IconCheck size={12} /> Saved at {new Date(savedAt).toISOString().slice(11, 19)}
                </span>
              )}
              <span className="ml-auto text-xs text-cm-muted">
                Last updated {fmtDate(profile.updatedAt)}{profile.updatedBy ? ` by ${profile.updatedBy}` : ''}
              </span>
            </div>
          </form>
        ) : null}
      </main>
    </div>
  );
}

const SMALL_BTN =
  'inline-flex items-center gap-1.5 rounded-md border border-cm-border bg-transparent px-2.5 py-1 text-xs text-cm-fg transition-colors hover:bg-cm-subtle';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      {hint && <span className="text-xs text-cm-muted">{hint}</span>}
      {children}
    </label>
  );
}
