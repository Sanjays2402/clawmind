'use client';
// Domain auto-join settings. Owners and admins manage a list of verified
// email domains. Anyone who signs in with a matching email and is not yet
// in the workspace is automatically enrolled as the policy's role. The
// list is replaced atomically on save and every change writes a
// before/after diff to the audit log.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  fmtRelative,
  type AutoJoinRole,
  type DomainPolicy,
} from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  SettingsCardSkeleton,
  Spinner,
  IconAt,
  IconPlus,
  IconTrash,
  IconCheck,
  IconArrowRight,
  IconShield,
  IconWarning,
} from '@clawmind/ui';

type Draft = { domain: string; role: AutoJoinRole; enabled: boolean; requireSso: boolean };

// Shared field chrome so the domain input and role select read as one
// control family on the paper surface.
const FIELD_CLS =
  'rounded-md border border-cm-border bg-cm-bg px-2.5 py-1.5 text-sm text-cm-fg outline-none placeholder:text-cm-faint focus:ring-2 focus:ring-cm-accent';

const ROLE_HELP: Record<AutoJoinRole, string> = {
  member: 'Read and write the product. Cannot manage other members.',
  viewer: 'Read only access. Cannot mutate any data.',
};

function explainError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.body && typeof err.body === 'object') {
      const b = err.body as { error?: string; message?: string };
      if (b.error === 'mfa step-up required' || (err.status === 401 && b.error === 'mfa step-up required')) {
        return 'MFA verification required. Open Settings then MFA to step up, then retry.';
      }
      if (b.error === 'forbidden') return 'You need admin or owner to manage domain policies.';
      if (b.error === 'invalid-domain') return b.message ?? 'One of the domains is not valid.';
      if (b.error === 'duplicate') return b.message ?? 'A domain appears more than once.';
      if (b.error === 'too-many') return b.message ?? 'Too many policies.';
      if (b.message) return b.message;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : 'something went wrong';
}

function rowsFromPolicies(p: readonly DomainPolicy[]): Draft[] {
  return p.map((row) => ({
    domain: row.domain,
    role: row.role,
    enabled: row.enabled,
    requireSso: row.requireSso === true,
  }));
}

function rowsEqual(a: Draft[], b: Draft[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (
      a[i]!.domain !== b[i]!.domain ||
      a[i]!.role !== b[i]!.role ||
      a[i]!.enabled !== b[i]!.enabled ||
      a[i]!.requireSso !== b[i]!.requireSso
    ) {
      return false;
    }
  }
  return true;
}

export default function DomainPoliciesPage() {
  const [original, setOriginal] = useState<Draft[] | null>(null);
  const [rows, setRows] = useState<Draft[] | null>(null);
  const [assignable, setAssignable] = useState<AutoJoinRole[]>(['member', 'viewer']);
  const [maxPolicies, setMaxPolicies] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [serverPolicies, setServerPolicies] = useState<DomainPolicy[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.domainPoliciesList();
      setServerPolicies(data.policies);
      const draft = rowsFromPolicies(data.policies);
      setOriginal(draft);
      setRows(draft.map((r) => ({ ...r })));
      setAssignable(data.assignableRoles);
      setMaxPolicies(data.maxPolicies);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(() => {
    if (!rows || !original) return false;
    return !rowsEqual(rows, original);
  }, [rows, original]);

  const addRow = () => {
    if (!rows) return;
    if (rows.length >= maxPolicies) return;
    setRows([...rows, { domain: '', role: 'member', enabled: true, requireSso: false }]);
  };

  const updateRow = (idx: number, patch: Partial<Draft>) => {
    if (!rows) return;
    setRows(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const removeRow = (idx: number) => {
    if (!rows) return;
    setRows(rows.filter((_, i) => i !== idx));
  };

  const save = async () => {
    if (!rows) return;
    setSaving(true);
    setSaveError(null);
    try {
      const cleaned = rows.map((r) => ({
        domain: r.domain.trim().replace(/^@/, '').toLowerCase(),
        role: r.role,
        enabled: r.enabled,
        requireSso: r.requireSso,
      }));
      // Cheap client-side empty check so the user sees a useful message
      // before the server round trip. The server is the source of truth
      // on validity.
      for (const c of cleaned) {
        if (!c.domain) {
          setSaveError('One of the rows has an empty domain.');
          setSaving(false);
          return;
        }
      }
      const updated = await api.domainPoliciesReplace(cleaned);
      setServerPolicies(updated);
      const next = rowsFromPolicies(updated);
      setOriginal(next);
      setRows(next.map((r) => ({ ...r })));
      setSavedAt(Date.now());
    } catch (err) {
      setSaveError(explainError(err));
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    if (!original) return;
    setRows(original.map((r) => ({ ...r })));
    setSaveError(null);
  };

  return (
    <div className="min-h-screen bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="mb-5">
          <nav className="mb-2 text-xs text-cm-muted">
            <Link href="/settings" className="hover:text-cm-fg hover:underline">Settings</Link>
            <span aria-hidden> / </span>
            <span>Domain auto-join</span>
          </nav>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
            <IconAt aria-hidden className="text-cm-accent" /> Domain auto-join
          </h1>
          <p className="mt-1 text-sm text-cm-muted">
            Anyone who signs in with an email matching an enabled domain joins the
            workspace as the policy role. Existing accounts are never silently
            promoted or demoted.
          </p>
        </header>

        {loading ? (
          <SettingsCardSkeleton rows={4} />
        ) : error ? (
          <ErrorState title="Could not load policies" message={error} onRetry={load} />
        ) : !rows ? null : (
          <>
            <section className="rounded-xl border border-cm-border bg-cm-paper p-4 sm:p-5">
              <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold tracking-tight text-cm-fg sm:text-base">Policies</h2>
                <span className="text-xs text-cm-muted tabular-nums">
                  {rows.length} of {maxPolicies}
                </span>
              </header>

              {rows.length === 0 ? (
                <EmptyState
                  icon={<IconAt aria-hidden />}
                  title="No domain policies yet"
                  body="Add a domain to auto-enrol new sign-ins from your company or partners."
                />
              ) : (
                <ul className="divide-y divide-cm-border">
                  {rows.map((row, idx) => (
                    <li key={idx} className="py-3 first:pt-0 last:pb-0">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
                        <label className="sr-only" htmlFor={`domain-${idx}`}>Domain</label>
                        <input
                          id={`domain-${idx}`}
                          type="text"
                          inputMode="email"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="acme.com"
                          value={row.domain}
                          onChange={(e) => updateRow(idx, { domain: e.target.value })}
                          className={`w-full font-mono tracking-tight ${FIELD_CLS}`}
                        />
                        <label className="sr-only" htmlFor={`role-${idx}`}>Role</label>
                        <select
                          id={`role-${idx}`}
                          value={row.role}
                          onChange={(e) => updateRow(idx, { role: e.target.value as AutoJoinRole })}
                          className={FIELD_CLS}
                        >
                          {assignable.map((r) => (
                            <option key={r} value={r}>
                              {r.charAt(0).toUpperCase() + r.slice(1)}
                            </option>
                          ))}
                        </select>
                        <label className="flex items-center gap-1.5 text-xs text-cm-muted">
                          <input
                            type="checkbox"
                            checked={row.enabled}
                            onChange={(e) => updateRow(idx, { enabled: e.target.checked })}
                            className="h-3.5 w-3.5 accent-[var(--cm-accent)]"
                          />
                          Enabled
                        </label>
                        <button
                          type="button"
                          onClick={() => removeRow(idx)}
                          aria-label={`Remove ${row.domain || 'row'}`}
                          className="inline-flex items-center justify-center rounded-md border border-cm-border bg-cm-bg p-1.5 text-cm-muted hover:bg-cm-subtle hover:text-cm-danger"
                        >
                          <IconTrash aria-hidden />
                        </button>
                      </div>
                      <p className="mt-1 text-xs text-cm-muted">{ROLE_HELP[row.role]}</p>
                      <label className="mt-2 flex items-start gap-2 rounded-md border border-cm-border bg-cm-subtle px-2.5 py-1.5 text-xs text-cm-muted">
                        <input
                          type="checkbox"
                          checked={row.requireSso}
                          onChange={(e) => updateRow(idx, { requireSso: e.target.checked })}
                          className="mt-0.5 h-3.5 w-3.5 accent-[var(--cm-accent)]"
                          aria-describedby={`require-sso-help-${idx}`}
                        />
                        <span>
                          <span className="font-medium text-cm-fg">Require SSO for this domain</span>
                          <span id={`require-sso-help-${idx}`} className="mt-0.5 block">
                            Sessions established via password or GitHub OAuth will be
                            rejected on the next request. Users must sign in through
                            your OIDC provider at /auth/oidc.
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={addRow}
                  disabled={rows.length >= maxPolicies}
                  className="inline-flex items-center gap-1.5 rounded-md border border-cm-border bg-cm-bg px-2.5 py-1.5 text-sm text-cm-fg hover:bg-cm-subtle disabled:opacity-50"
                >
                  <IconPlus aria-hidden /> Add domain
                </button>
                <div className="flex-1" />
                {dirty ? (
                  <button
                    type="button"
                    onClick={reset}
                    disabled={saving}
                    className="rounded-md border border-cm-border bg-cm-bg px-2.5 py-1.5 text-sm text-cm-fg hover:bg-cm-subtle disabled:opacity-50"
                  >
                    Reset
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={save}
                  disabled={!dirty || saving}
                  className="inline-flex items-center gap-1.5 rounded-md bg-cm-fg px-3 py-1.5 text-sm font-medium text-cm-bg transition hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? <Spinner /> : <IconCheck aria-hidden />}
                  Save policies
                </button>
              </div>

              {saveError ? (
                <p role="alert" className="mt-3 flex items-start gap-1.5 rounded-md border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] px-3 py-2 text-sm text-cm-danger">
                  <IconWarning aria-hidden className="mt-0.5 shrink-0" /> <span>{saveError}</span>
                </p>
              ) : null}
              {!saveError && savedAt && !dirty ? (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-cm-success">
                  <IconCheck aria-hidden /> Saved {fmtRelative(savedAt)}
                </p>
              ) : null}
            </section>

            <section className="mt-5 rounded-xl border border-cm-border bg-cm-paper p-4 sm:p-5">
              <header className="mb-2 flex items-center gap-2">
                <IconShield aria-hidden className="text-cm-accent" />
                <h2 className="text-sm font-semibold tracking-tight text-cm-fg sm:text-base">How matching works</h2>
              </header>
              <ul className="space-y-1.5 text-sm text-cm-muted">
                <li>Matches the part after the last @ in the email, case-insensitive.</li>
                <li>Only assigns member or viewer. Admin and owner still require an explicit invite.</li>
                <li>Existing members keep whatever role they already have on next login.</li>
                <li>Require SSO blocks non-OIDC sessions for matching emails the moment you save.</li>
                <li>Every change writes a before and after diff to the audit log.</li>
              </ul>
              <p className="mt-3 text-xs text-cm-muted">
                Need granular invites instead?{' '}
                <Link href="/settings/members" className="inline-flex items-center gap-0.5 underline hover:text-cm-fg">
                  Go to members <IconArrowRight aria-hidden />
                </Link>
              </p>

              {serverPolicies.length > 0 ? (
                <p className="mt-3 text-xs text-cm-muted tabular-nums">
                  Newest update {fmtRelative(Math.max(...serverPolicies.map((p) => p.updatedAt)))}
                </p>
              ) : null}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
