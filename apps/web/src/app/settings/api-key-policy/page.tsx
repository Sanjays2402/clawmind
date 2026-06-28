'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  type ApiKeyPolicy,
  type ApiKeyPolicyLimits,
  ApiError,
} from '@/lib/api';
import {
  ErrorState,
  SettingsCardSkeleton,
  Spinner,
  IconArrowRight,
  IconCheck,
  IconKey,
  IconShield,
  IconWarning,
} from '@clawmind/ui';

// Shared input styling: theme-aware surface + brand focus ring so the
// number fields stop rendering on the foreign shadcn focus:ring-ring.
const INPUT_CLS =
  'mt-1 w-full rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm text-cm-fg outline-none placeholder:text-cm-faint focus:ring-2 focus:ring-cm-accent';

function fmtMinutes(min: number): string {
  if (min <= 0) return 'unset';
  if (min < 60) return `${min} min`;
  const h = min / 60;
  if (h < 24) return h % 1 === 0 ? `${h} h` : `${h.toFixed(1)} h`;
  const d = h / 24;
  return d % 1 === 0 ? `${d} d` : `${d.toFixed(1)} d`;
}

function fmtDate(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

interface FormState {
  maxTtlMinutes: number;
  requireExpiry: boolean;
  maxActiveKeysPerUser: number;
  maxScopesPerKey: number;
  allowWildcardScope: boolean;
  forcedRotationDays: number;
}

// How many of the six caps are actually constraining key minting right now.
// An all-zero / wildcard-allowed policy means new keys are unrestricted - a
// posture gap an enterprise reviewer asks about, so we surface it as caution.
function activeCaps(p: ApiKeyPolicy | FormState): number {
  let n = 0;
  if (p.maxTtlMinutes > 0) n++;
  if (p.requireExpiry) n++;
  if (p.maxActiveKeysPerUser > 0) n++;
  if (p.maxScopesPerKey > 0) n++;
  if (!p.allowWildcardScope) n++;
  if (p.forcedRotationDays > 0) n++;
  return n;
}

export default function ApiKeyPolicyPage() {
  const [policy, setPolicy] = useState<ApiKeyPolicy | null>(null);
  const [limits, setLimits] = useState<ApiKeyPolicyLimits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.apiKeyPolicyGet();
      setPolicy(res.policy);
      setLimits(res.limits);
      setForm({
        maxTtlMinutes: res.policy.maxTtlMinutes,
        requireExpiry: res.policy.requireExpiry,
        maxActiveKeysPerUser: res.policy.maxActiveKeysPerUser,
        maxScopesPerKey: res.policy.maxScopesPerKey,
        allowWildcardScope: res.policy.allowWildcardScope,
        forcedRotationDays: res.policy.forcedRotationDays,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You need admin or owner access to view the API key policy.');
      } else {
        setError(err instanceof Error ? err.message : 'failed to load');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setActionError(null);
    setSaving(true);
    try {
      const next = await api.apiKeyPolicySet(form);
      setPolicy(next);
      setSavedAt(Date.now());
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'save failed';
      setActionError(msg);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (
      !window.confirm(
        'Turn off every cap? New API keys will be unrestricted again. Existing keys are unaffected.',
      )
    )
      return;
    setActionError(null);
    setSaving(true);
    try {
      const next = await api.apiKeyPolicySet({
        maxTtlMinutes: 0,
        requireExpiry: false,
        maxActiveKeysPerUser: 0,
        maxScopesPerKey: 0,
        allowWildcardScope: true,
        forcedRotationDays: 0,
      });
      setPolicy(next);
      setForm({
        maxTtlMinutes: 0,
        requireExpiry: false,
        maxActiveKeysPerUser: 0,
        maxScopesPerKey: 0,
        allowWildcardScope: true,
        forcedRotationDays: 0,
      });
      setSavedAt(Date.now());
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'save failed';
      setActionError(msg);
    } finally {
      setSaving(false);
    }
  };

  // Banner reflects the LIVE saved posture (not the unsaved draft) so it reads
  // as the current enforcement state of the workspace.
  const caps = policy ? activeCaps(policy) : 0;
  const enforced = caps > 0;

  return (
    <main className="min-h-dvh bg-cm-bg text-cm-fg">
      <TopNav />
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
        <nav className="mb-6 flex items-center gap-2 text-sm text-cm-muted">
          <Link href="/settings" className="hover:text-cm-fg hover:underline">
            Settings
          </Link>
          <IconArrowRight className="h-3 w-3" />
          <span className="text-cm-fg">API key policy</span>
        </nav>

        <header className="mb-8 flex items-start gap-3">
          <span className="mt-0.5 rounded-md border border-cm-border bg-cm-subtle p-2 text-cm-accent">
            <IconKey className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">API key policy</h1>
            <p className="mt-1 text-sm text-cm-muted">
              Workspace-wide caps applied when any member mints or rotates an API key.
              Existing keys keep working until they expire or get revoked. Tighten these
              before an enterprise security review.
            </p>
          </div>
        </header>

        {loading && <SettingsCardSkeleton rows={3} />}

        {error && !loading && (
          <ErrorState
            title="Unable to load policy"
            message={error}
            onRetry={load}
            retryLabel="Retry"
          />
        )}

        {policy && limits && form && !loading && !error && (
          <form onSubmit={save} className="space-y-6">
            <div
              className={`flex items-start gap-2.5 rounded-lg border p-3 text-sm ${
                enforced
                  ? 'border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] text-cm-success'
                  : 'border-cm-cite-line bg-cm-cite-bg text-cm-cite'
              }`}
            >
              {enforced ? (
                <IconShield className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>
                {enforced ? (
                  <>
                    Policy enforced &mdash;{' '}
                    <span className="font-medium">
                      {caps} of 6 cap{caps === 1 ? '' : 's'}
                    </span>{' '}
                    constrain new keys.
                  </>
                ) : (
                  <>
                    Unrestricted &mdash; no caps are active, so new keys can be minted
                    with any TTL, scope, and count. Tighten at least one control below.
                  </>
                )}
              </span>
            </div>

            <section className="rounded-lg border border-cm-border bg-cm-paper p-5">
              <h2 className="text-sm font-semibold text-cm-fg">Lifetime caps</h2>
              <p className="mt-1 text-xs text-cm-muted">
                Limit how long any single key can stay valid. Zero means no cap.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium text-cm-fg">Max TTL (minutes)</span>
                  <input
                    type="number"
                    min={0}
                    max={limits.maxTtlMinutes}
                    value={form.maxTtlMinutes}
                    onChange={(e) =>
                      setForm({ ...form, maxTtlMinutes: Number(e.target.value) || 0 })
                    }
                    className={INPUT_CLS}
                  />
                  <span className="mt-1 block text-[11px] text-cm-muted">
                    {fmtMinutes(form.maxTtlMinutes)} (max {fmtMinutes(limits.maxTtlMinutes)})
                  </span>
                </label>
                <label className="flex items-start gap-2 rounded-md border border-cm-border bg-cm-bg p-3">
                  <input
                    type="checkbox"
                    checked={form.requireExpiry}
                    onChange={(e) =>
                      setForm({ ...form, requireExpiry: e.target.checked })
                    }
                    className="mt-0.5 h-3.5 w-3.5 accent-[var(--cm-accent)]"
                  />
                  <span>
                    <span className="block text-xs font-medium text-cm-fg">Require expiry</span>
                    <span className="mt-0.5 block text-[11px] text-cm-muted">
                      Reject never-expire keys. Needs a non-zero max TTL.
                    </span>
                  </span>
                </label>
              </div>
            </section>

            <section className="rounded-lg border border-cm-border bg-cm-paper p-5">
              <h2 className="text-sm font-semibold text-cm-fg">Scope and count caps</h2>
              <p className="mt-1 text-xs text-cm-muted">
                Reduce blast radius of any individual credential.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium text-cm-fg">Max active keys per user</span>
                  <input
                    type="number"
                    min={0}
                    max={limits.maxActiveKeysPerUser}
                    value={form.maxActiveKeysPerUser}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        maxActiveKeysPerUser: Number(e.target.value) || 0,
                      })
                    }
                    className={INPUT_CLS}
                  />
                  <span className="mt-1 block text-[11px] text-cm-muted">
                    {form.maxActiveKeysPerUser === 0
                      ? 'no cap'
                      : `${form.maxActiveKeysPerUser} keys`}
                  </span>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-cm-fg">Max scopes per key</span>
                  <input
                    type="number"
                    min={0}
                    max={limits.maxScopesPerKey}
                    value={form.maxScopesPerKey}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        maxScopesPerKey: Number(e.target.value) || 0,
                      })
                    }
                    className={INPUT_CLS}
                  />
                  <span className="mt-1 block text-[11px] text-cm-muted">
                    {form.maxScopesPerKey === 0
                      ? 'no cap'
                      : `${form.maxScopesPerKey} scopes`}
                  </span>
                </label>
                <label className="flex items-start gap-2 rounded-md border border-cm-border bg-cm-bg p-3 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={form.allowWildcardScope}
                    onChange={(e) =>
                      setForm({ ...form, allowWildcardScope: e.target.checked })
                    }
                    className="mt-0.5 h-3.5 w-3.5 accent-[var(--cm-accent)]"
                  />
                  <span>
                    <span className="block text-xs font-medium text-cm-fg">
                      Allow wildcard scope ({'*'})
                    </span>
                    <span className="mt-0.5 block text-[11px] text-cm-muted">
                      Uncheck to force every key to enumerate explicit scopes.
                    </span>
                  </span>
                </label>
              </div>
            </section>

            <section className="rounded-lg border border-cm-border bg-cm-paper p-5">
              <h2 className="text-sm font-semibold text-cm-fg">Rotation reminders</h2>
              <p className="mt-1 text-xs text-cm-muted">
                Surface a needs-rotation flag on the keys list once a key passes this age.
              </p>
              <label className="mt-4 block">
                <span className="text-xs font-medium text-cm-fg">Forced rotation (days)</span>
                <input
                  type="number"
                  min={0}
                  max={limits.maxForcedRotationDays}
                  value={form.forcedRotationDays}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      forcedRotationDays: Number(e.target.value) || 0,
                    })
                  }
                  className={`max-w-xs ${INPUT_CLS}`}
                />
                <span className="mt-1 block text-[11px] text-cm-muted">
                  {form.forcedRotationDays === 0
                    ? 'no reminder'
                    : `flag keys older than ${form.forcedRotationDays} days`}
                </span>
              </label>
            </section>

            {actionError && (
              <div className="flex items-start gap-2 rounded-md border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] p-3 text-sm text-cm-danger">
                <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{actionError}</span>
              </div>
            )}
            {savedAt && !actionError && (
              <div className="flex items-center gap-2 rounded-md border border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] p-3 text-sm text-cm-success">
                <IconCheck className="h-4 w-4 shrink-0" />
                Saved {fmtDate(savedAt)}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-md bg-cm-fg px-4 py-2 text-sm font-medium text-cm-bg hover:opacity-90 disabled:opacity-50"
              >
                {saving ? <Spinner /> : <IconShield className="h-4 w-4" />}
                Save policy
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] px-4 py-2 text-sm font-medium text-cm-danger transition hover:bg-[rgba(180,66,60,0.18)] disabled:opacity-50"
              >
                Clear all caps
              </button>
              <span className="ml-auto text-xs text-cm-muted">
                Last changed by {policy.updatedBy ?? 'system'} at {fmtDate(policy.updatedAt)}
              </span>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
