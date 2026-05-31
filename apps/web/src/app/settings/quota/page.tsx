'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  type WorkspaceQuotaStatus,
} from '@/lib/api';
import {
  ErrorState,
  Spinner,
  IconArrowRight,
  IconChartBar,
  IconCheck,
  IconRefresh,
  IconShield,
  IconUsers,
  IconWarning,
} from '@clawmind/ui';

// Workspace-wide monthly request quota. Owner-only. Controls the
// "spend cap" that enterprise procurement reviewers ask about during
// security review. Empty input means unlimited.

type FieldKey = 'monthlyLimit' | 'perUserMonthlyLimit';

function toInputValue(n: number | null | undefined): string {
  return n === null || n === undefined ? '' : String(n);
}

function parseField(raw: string): number | null | 'invalid' {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 1) return 'invalid';
  return n;
}

function fmtCeiling(n: number | null): string {
  return n === null ? 'Unlimited' : n.toLocaleString();
}

function fmtPct(used: number, limit: number | null): string {
  if (limit === null || limit <= 0) return '0%';
  return `${Math.min(100, Math.round((used / limit) * 100))}%`;
}

function fmtResetIn(resetsAt: number): string {
  const ms = resetsAt - Date.now();
  if (ms <= 0) return 'soon';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}h ${mins}m`;
}

export default function WorkspaceQuotaPage() {
  const [data, setData] = useState<WorkspaceQuotaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<Record<FieldKey, string>>({
    monthlyLimit: '',
    perUserMonthlyLimit: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await api.workspaceQuotaGet();
      setData(status);
      setDraft({
        monthlyLimit: toInputValue(status.policy.monthlyLimit),
        perUserMonthlyLimit: toInputValue(status.policy.perUserMonthlyLimit),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('Only workspace admins can view the quota policy.');
      } else if (err instanceof ApiError && err.status === 401) {
        setError('Sign in required.');
      } else {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setFieldErrors({});
    const patch: { monthlyLimit?: number | null; perUserMonthlyLimit?: number | null } = {};
    const errs: Partial<Record<FieldKey, string>> = {};
    for (const k of ['monthlyLimit', 'perUserMonthlyLimit'] as FieldKey[]) {
      const parsed = parseField(draft[k]);
      if (parsed === 'invalid') errs[k] = 'Must be a positive integer or blank for unlimited';
      else patch[k] = parsed;
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setSaving(true);
    try {
      await api.workspaceQuotaPut(patch);
      setSavedAt(Date.now());
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('Only the workspace owner can change the quota.');
      } else if (err instanceof ApiError && err.status === 401) {
        setError('MFA step-up required. Verify and try again.');
      } else {
        setError((err as Error).message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Workspace quota</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Monthly request ceiling enforced on ask, search, and batch. Blank means unlimited.
            </p>
          </div>
          <Link
            href="/settings"
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            Settings <IconArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading policy
          </div>
        ) : error ? (
          <ErrorState
            title="Could not load workspace quota"
            message={error}
            onRetry={() => void load()}
          />
        ) : data ? (
          <div className="space-y-6">
            <section className="rounded-lg border bg-card p-5">
              <div className="mb-4 flex items-center gap-2">
                <IconChartBar className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-sm font-medium">This month</h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <div className="text-xs text-muted-foreground">Used</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">
                    {data.usage.used.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    of {fmtCeiling(data.effective.monthlyLimit)} (
                    {fmtPct(data.usage.used, data.effective.monthlyLimit)})
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Active members</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">
                    {data.usage.members}
                  </div>
                  <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
                    <IconUsers className="h-3 w-3" /> consumed at least 1 unit
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Resets in</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">
                    {fmtResetIn(data.usage.resetsAt)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(data.usage.resetsAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex gap-4 text-xs text-muted-foreground">
                <span>Ask: {data.usage.byKind.ask.toLocaleString()}</span>
                <span>Search: {data.usage.byKind.search.toLocaleString()}</span>
              </div>
            </section>

            <section className="rounded-lg border bg-card p-5">
              <div className="mb-4 flex items-center gap-2">
                <IconShield className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-sm font-medium">Policy</h2>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium" htmlFor="monthlyLimit">
                    Workspace monthly limit
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Total billable units across every member and API key. Blank means unlimited.
                  </p>
                  <input
                    id="monthlyLimit"
                    type="text"
                    inputMode="numeric"
                    value={draft.monthlyLimit}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, monthlyLimit: e.target.value }))
                    }
                    placeholder="e.g. 10000"
                    className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  {fieldErrors.monthlyLimit ? (
                    <div className="mt-1 text-xs text-destructive inline-flex items-center gap-1">
                      <IconWarning className="h-3 w-3" /> {fieldErrors.monthlyLimit}
                    </div>
                  ) : null}
                </div>
                <div>
                  <label className="text-sm font-medium" htmlFor="perUser">
                    Per member monthly limit
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Optional secondary cap so one runaway integration cannot drain the workspace ceiling.
                  </p>
                  <input
                    id="perUser"
                    type="text"
                    inputMode="numeric"
                    value={draft.perUserMonthlyLimit}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, perUserMonthlyLimit: e.target.value }))
                    }
                    placeholder="blank = no per-member cap"
                    className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  {fieldErrors.perUserMonthlyLimit ? (
                    <div className="mt-1 text-xs text-destructive inline-flex items-center gap-1">
                      <IconWarning className="h-3 w-3" /> {fieldErrors.perUserMonthlyLimit}
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center justify-between pt-2">
                  <div className="text-xs text-muted-foreground">
                    {data.policy.updatedAt > 0
                      ? `Updated ${new Date(data.policy.updatedAt).toLocaleString()} by ${data.policy.updatedBy ?? 'unknown'}`
                      : 'Never updated (using defaults)'}
                  </div>
                  <button
                    onClick={() => void save()}
                    disabled={saving}
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {saving ? <Spinner /> : <IconCheck className="h-4 w-4" />}
                    Save policy
                  </button>
                </div>
                {savedAt ? (
                  <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
                    <IconCheck className="h-3 w-3" /> Saved {new Date(savedAt).toLocaleTimeString()}
                  </div>
                ) : null}
              </div>
            </section>

            <p className="text-xs text-muted-foreground">
              Mutations to this policy are recorded in the audit chain and require MFA step-up
              for the workspace owner.
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
