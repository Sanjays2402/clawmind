'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  type Incident,
  type IncidentInput,
  type IncidentSeverity,
  type IncidentStatus,
} from '@/lib/api';
import { ErrorState, Spinner, IconCheck, IconPlus, IconRefresh, IconShield, IconTrash, IconWarning } from '@clawmind/ui';

// Owner-only Security Incident editor. The unauthenticated public list
// at /incidents is what procurement reviewers actually see; this page
// is the admin console that produces it. Every save round-trips through
// POST/PUT /v1/incidents, which requires owner role and MFA step-up.

const SEVERITIES: { value: IncidentSeverity; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const STATUSES: { value: IncidentStatus; label: string }[] = [
  { value: 'investigating', label: 'Investigating' },
  { value: 'identified', label: 'Identified' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'resolved', label: 'Resolved' },
];

function toLocalDateTime(ts: number | null): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return ''; }
}

function fromLocalDateTime(s: string): number | null {
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

function blank(): Incident {
  return {
    id: '',
    title: '',
    summary: '',
    severity: 'low',
    status: 'investigating',
    startedAt: Date.now(),
    resolvedAt: null,
    affectedComponents: [],
    customerDataImpacted: false,
    updates: [],
    privateNotes: '',
    createdAt: 0,
    updatedAt: 0,
    updatedBy: null,
  };
}

export default function IncidentsAdminPage() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Incident | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.incidentsAdmin();
      setIncidents(list);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You need admin or owner access to view incidents.');
      } else if (err instanceof ApiError && err.status === 401) {
        setError('Sign in to view incidents.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load incidents.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const update = useCallback(<K extends keyof Incident>(key: K, value: Incident[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }, []);

  const save = useCallback(async () => {
    if (!draft) return;
    setSubmitting(true);
    setActionError(null);
    const body: IncidentInput = {
      title: draft.title,
      summary: draft.summary,
      severity: draft.severity,
      status: draft.status,
      startedAt: draft.startedAt,
      resolvedAt: draft.status === 'resolved' ? draft.resolvedAt : null,
      affectedComponents: draft.affectedComponents,
      customerDataImpacted: draft.customerDataImpacted,
      updates: draft.updates.map((u) => ({ at: u.at, message: u.message, status: u.status })),
      privateNotes: draft.privateNotes,
    };
    try {
      const saved = draft.id
        ? await api.incidentsUpdate(draft.id, body)
        : await api.incidentsCreate(body);
      setDraft(null);
      await load();
      void saved;
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
  }, [draft, load]);

  const remove = useCallback(async (id: string) => {
    if (!confirm('Delete this incident from the public log?')) return;
    setActionError(null);
    try {
      await api.incidentsDelete(id);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setActionError('Owner role with MFA is required to delete.');
      } else {
        setActionError(err instanceof Error ? err.message : 'Delete failed.');
      }
    }
  }, [load]);

  return (
    <>
      <TopNav />
      <main style={{ maxWidth: 880, margin: '40px auto', padding: '0 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <IconShield size={22} />
              <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Security Incidents</h1>
            </div>
            <p style={{ color: 'var(--cm-muted)', margin: '6px 0 0' }}>
              Disclose past incidents on the public timeline that procurement reviewers cite by URL.
              <Link href="/incidents" style={{ marginLeft: 8 }}>View public page</Link>
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setDraft(blank())}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', border: '1px solid var(--cm-border, #e5e7eb)', borderRadius: 8, background: '#111827', color: 'white', cursor: 'pointer' }}
            >
              <IconPlus size={16} /> New incident
            </button>
            <button
              onClick={() => void load()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', border: '1px solid var(--cm-border, #e5e7eb)', borderRadius: 8, background: 'transparent', cursor: 'pointer' }}
            >
              <IconRefresh size={16} /> Refresh
            </button>
          </div>
        </div>

        {loading && (
          <div style={{ padding: 40, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--cm-muted)' }}>
            <Spinner /> Loading incidents...
          </div>
        )}
        {error && !loading && <ErrorState message={error} />}
        {actionError && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#b91c1c', marginTop: 12 }}>
            <IconWarning size={16} /> {actionError}
          </div>
        )}

        {draft && (
          <form
            onSubmit={(e) => { e.preventDefault(); void save(); }}
            style={{ marginTop: 24, padding: 16, border: '1px solid var(--cm-border, #e5e7eb)', borderRadius: 12, display: 'grid', gap: 16 }}
          >
            <h2 style={{ fontSize: 16, margin: 0 }}>{draft.id ? 'Edit incident' : 'New incident'}</h2>
            <Field label="Title">
              <input value={draft.title} onChange={(e) => update('title', e.target.value)} style={inputStyle} maxLength={200} required />
            </Field>
            <Field label="Summary" hint="Plain text shown on the public timeline.">
              <textarea value={draft.summary} onChange={(e) => update('summary', e.target.value)} rows={3} maxLength={4000} style={inputStyle} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <Field label="Severity">
                <select value={draft.severity} onChange={(e) => update('severity', e.target.value as IncidentSeverity)} style={inputStyle}>
                  {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select
                  value={draft.status}
                  onChange={(e) => {
                    const v = e.target.value as IncidentStatus;
                    setDraft((d) => d ? {
                      ...d,
                      status: v,
                      resolvedAt: v === 'resolved' ? (d.resolvedAt ?? Date.now()) : null,
                    } : d);
                  }}
                  style={inputStyle}
                >
                  {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Started at">
                <input
                  type="datetime-local"
                  value={toLocalDateTime(draft.startedAt)}
                  onChange={(e) => { const v = fromLocalDateTime(e.target.value); if (v) update('startedAt', v); }}
                  style={inputStyle}
                  required
                />
              </Field>
              {draft.status === 'resolved' && (
                <Field label="Resolved at">
                  <input
                    type="datetime-local"
                    value={toLocalDateTime(draft.resolvedAt)}
                    onChange={(e) => update('resolvedAt', fromLocalDateTime(e.target.value))}
                    style={inputStyle}
                    required
                  />
                </Field>
              )}
            </div>
            <Field label="Affected components" hint="Comma-separated, e.g. api, web, ingest">
              <input
                value={draft.affectedComponents.join(', ')}
                onChange={(e) => update('affectedComponents', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                style={inputStyle}
                maxLength={500}
              />
            </Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={draft.customerDataImpacted} onChange={(e) => update('customerDataImpacted', e.target.checked)} />
              Customer data was exposed, modified, or destroyed
            </label>
            <Field label="Private notes" hint="Operator-only; never shown publicly.">
              <textarea value={draft.privateNotes} onChange={(e) => update('privateNotes', e.target.value)} rows={3} maxLength={4000} style={inputStyle} />
            </Field>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                type="submit"
                disabled={submitting}
                style={{ padding: '10px 16px', borderRadius: 8, background: '#111827', color: 'white', border: 'none', cursor: submitting ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                {submitting ? <Spinner /> : <IconCheck size={16} />}
                {submitting ? 'Saving...' : (draft.id ? 'Save changes' : 'Publish incident')}
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                style={{ padding: '10px 16px', borderRadius: 8, border: '1px solid var(--cm-border, #e5e7eb)', background: 'transparent', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {incidents && !loading && !error && incidents.length === 0 && !draft && (
          <div style={{ marginTop: 24, padding: 24, border: '1px dashed var(--cm-border, #e5e7eb)', borderRadius: 12, color: 'var(--cm-muted)' }}>
            No incidents have been published. Buyers expect an empty log to exist, not to 404.
          </div>
        )}

        {incidents && incidents.length > 0 && (
          <ul style={{ marginTop: 24, listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
            {incidents.map((inc) => (
              <li key={inc.id} style={{ padding: 16, border: '1px solid var(--cm-border, #e5e7eb)', borderRadius: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{inc.title}</div>
                    <div style={{ color: 'var(--cm-muted)', fontSize: 13, marginTop: 4 }}>
                      {inc.severity.toUpperCase()} &middot; {inc.status} &middot; {new Date(inc.startedAt).toISOString().slice(0, 16).replace('T', ' ')}
                      {inc.customerDataImpacted && <span style={{ color: '#b91c1c', marginLeft: 8 }}>customer data impacted</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setDraft(inc)} style={smallButton}>Edit</button>
                    <button onClick={() => void remove(inc.id)} style={smallButton} aria-label="Delete incident">
                      <IconTrash size={14} /> Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
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
