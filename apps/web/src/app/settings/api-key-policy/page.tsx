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
  Spinner,
  IconArrowRight,
  IconCheck,
  IconKey,
  IconShield,
  IconWarning,
} from '@clawmind/ui';

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

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <TopNav />
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
        <nav className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/settings" className="hover:underline">
            Settings
          </Link>
          <IconArrowRight className="h-3 w-3" />
          <span>API key policy</span>
        </nav>

        <header className="mb-8 flex items-start gap-3">
          <IconKey className="mt-1 h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">API key policy</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Workspace-wide caps applied when any member mints or rotates an API key.
              Existing keys keep working until they expire or get revoked. Tighten these
              before an enterprise security review.
            </p>
          </div>
        </header>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading policy
          </div>
        )}

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
            <section className="rounded-lg border bg-card p-5">
              <h2 className="text-sm font-semibold">Lifetime caps</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Limit how long any single key can stay valid. Zero means no cap.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium">Max TTL (minutes)</span>
                  <input
                    type="number"
                    min={0}
                    max={limits.maxTtlMinutes}
                    value={form.maxTtlMinutes}
                    onChange={(e) =>
                      setForm({ ...form, maxTtlMinutes: Number(e.target.value) || 0 })
                    }
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {fmtMinutes(form.maxTtlMinutes)} (max {fmtMinutes(limits.maxTtlMinutes)})
                  </span>
                </label>
                <label className="flex items-start gap-2 rounded-md border bg-background p-3">
                  <input
                    type="checkbox"
                    checked={form.requireExpiry}
                    onChange={(e) =>
                      setForm({ ...form, requireExpiry: e.target.checked })
                    }
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-xs font-medium">Require expiry</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      Reject never-expire keys. Needs a non-zero max TTL.
                    </span>
                  </span>
                </label>
              </div>
            </section>

            <section className="rounded-lg border bg-card p-5">
              <h2 className="text-sm font-semibold">Scope and count caps</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Reduce blast radius of any individual credential.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium">Max active keys per user</span>
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
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {form.maxActiveKeysPerUser === 0
                      ? 'no cap'
                      : `${form.maxActiveKeysPerUser} keys`}
                  </span>
                </label>
                <label className="block">
                  <span className="text-xs font-medium">Max scopes per key</span>
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
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {form.maxScopesPerKey === 0
                      ? 'no cap'
                      : `${form.maxScopesPerKey} scopes`}
                  </span>
                </label>
                <label className="flex items-start gap-2 rounded-md border bg-background p-3 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={form.allowWildcardScope}
                    onChange={(e) =>
                      setForm({ ...form, allowWildcardScope: e.target.checked })
                    }
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-xs font-medium">
                      Allow wildcard scope ({'*'})
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      Uncheck to force every key to enumerate explicit scopes.
                    </span>
                  </span>
                </label>
              </div>
            </section>

            <section className="rounded-lg border bg-card p-5">
              <h2 className="text-sm font-semibold">Rotation reminders</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Surface a needs-rotation flag on the keys list once a key passes this age.
              </p>
              <label className="mt-4 block">
                <span className="text-xs font-medium">Forced rotation (days)</span>
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
                  className="mt-1 w-full max-w-xs rounded-md border bg-background px-3 py-2 text-sm"
                />
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  {form.forcedRotationDays === 0
                    ? 'no reminder'
                    : `flag keys older than ${form.forcedRotationDays} days`}
                </span>
              </label>
            </section>

            {actionError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                <IconWarning className="mt-0.5 h-4 w-4" />
                <span>{actionError}</span>
              </div>
            )}
            {savedAt && !actionError && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <IconCheck className="h-4 w-4 text-emerald-500" />
                Saved {fmtDate(savedAt)}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {saving ? <Spinner /> : <IconShield className="h-4 w-4" />}
                Save policy
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
              >
                Clear all caps
              </button>
              <span className="ml-auto text-xs text-muted-foreground">
                Last changed by {policy.updatedBy ?? 'system'} at {fmtDate(policy.updatedAt)}
              </span>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
