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
  SettingsCardSkeleton,
  Spinner,
  IconArrowRight,
  IconChartBar,
  IconCheck,
  IconShield,
  IconUsers,
  IconWarning,
} from '@clawmind/ui';

// Workspace-wide monthly request quota. Owner-only. Controls the
// "spend cap" that enterprise procurement reviewers ask about during
// security review. Empty input means unlimited.

// Shared input styling: theme-aware surface + brand focus ring.
const INPUT_CLS =
  'mt-2 w-full rounded-md border border-cm-border bg-cm-bg px-3 py-2 text-sm text-cm-fg outline-none placeholder:text-cm-faint focus:ring-2 focus:ring-cm-accent';

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

function usedPct(used: number, limit: number | null): number {
  if (limit === null || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
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

// Three-state health derived from this month's consumption against the
// effective ceiling. Unlimited workspaces are always "ok". This drives the
// header banner + the meter color so the posture reads at a glance.
type Health = 'ok' | 'near' | 'over';

function quotaHealth(used: number, limit: number | null): Health {
  if (limit === null || limit <= 0) return 'ok';
  if (used >= limit) return 'over';
  if (used / limit >= 0.8) return 'near';
  return 'ok';
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

  const health: Health = data
    ? quotaHealth(data.usage.used, data.effective.monthlyLimit)
    : 'ok';
  const pct = data ? usedPct(data.usage.used, data.effective.monthlyLimit) : 0;
  const capped = !!data && data.effective.monthlyLimit !== null;

  const meterColor =
    health === 'over'
      ? 'var(--cm-danger)'
      : health === 'near'
        ? 'var(--cm-cite)'
        : 'var(--cm-success)';

  return (
    <div className="min-h-screen bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Workspace quota</h1>
            <p className="mt-1 text-sm text-cm-muted">
              Monthly request ceiling enforced on ask, search, and batch. Blank means unlimited.
            </p>
          </div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-sm text-cm-muted hover:text-cm-fg"
          >
            Settings <IconArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {loading ? (
          <SettingsCardSkeleton rows={3} />
        ) : error ? (
          <ErrorState
            title="Could not load workspace quota"
            message={error}
            onRetry={() => void load()}
          />
        ) : data ? (
          <div className="space-y-6">
            {capped && (
              <div
                className={`flex items-start gap-2.5 rounded-lg border p-3 text-sm ${
                  health === 'over'
                    ? 'border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] text-cm-danger'
                    : health === 'near'
                      ? 'border-cm-cite-line bg-cm-cite-bg text-cm-cite'
                      : 'border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] text-cm-success'
                }`}
              >
                {health === 'ok' ? (
                  <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span>
                  {health === 'over' ? (
                    <>
                      Quota exhausted &mdash; this workspace has used{' '}
                      <span className="font-medium">{pct}%</span> of its monthly
                      ceiling. New ask and search calls are being rejected with 429
                      until the reset.
                    </>
                  ) : health === 'near' ? (
                    <>
                      Approaching the ceiling &mdash;{' '}
                      <span className="font-medium">{pct}%</span> consumed. Raise the
                      limit or expect throttling before the reset.
                    </>
                  ) : (
                    <>
                      Healthy &mdash; <span className="font-medium">{pct}%</span> of the
                      monthly ceiling used.
                    </>
                  )}
                </span>
              </div>
            )}

            <section className="rounded-lg border border-cm-border bg-cm-paper p-5">
              <div className="mb-4 flex items-center gap-2">
                <IconChartBar className="h-5 w-5 text-cm-muted" />
                <h2 className="text-sm font-medium text-cm-fg">This month</h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <div className="text-xs text-cm-muted">Used</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-cm-fg">
                    {data.usage.used.toLocaleString()}
                  </div>
                  <div className="text-xs text-cm-muted">
                    of {fmtCeiling(data.effective.monthlyLimit)}
                    {capped ? ` (${pct}%)` : ''}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-cm-muted">Active members</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-cm-fg">
                    {data.usage.members}
                  </div>
                  <div className="inline-flex items-center gap-1 text-xs text-cm-muted">
                    <IconUsers className="h-3 w-3" /> consumed at least 1 unit
                  </div>
                </div>
                <div>
                  <div className="text-xs text-cm-muted">Resets in</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-cm-fg">
                    {fmtResetIn(data.usage.resetsAt)}
                  </div>
                  <div className="text-xs text-cm-muted">
                    {new Date(data.usage.resetsAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
              {capped && (
                <div className="mt-4">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-cm-subtle">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.max(2, pct)}%`, background: meterColor }}
                    />
                  </div>
                </div>
              )}
              <div className="mt-4 flex gap-4 text-xs text-cm-muted">
                <span>Ask: {data.usage.byKind.ask.toLocaleString()}</span>
                <span>Search: {data.usage.byKind.search.toLocaleString()}</span>
              </div>
            </section>

            <section className="rounded-lg border border-cm-border bg-cm-paper p-5">
              <div className="mb-4 flex items-center gap-2">
                <IconShield className="h-5 w-5 text-cm-muted" />
                <h2 className="text-sm font-medium text-cm-fg">Policy</h2>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-cm-fg" htmlFor="monthlyLimit">
                    Workspace monthly limit
                  </label>
                  <p className="text-xs text-cm-muted">
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
                    className={INPUT_CLS}
                  />
                  {fieldErrors.monthlyLimit ? (
                    <div className="mt-1 inline-flex items-center gap-1 text-xs text-cm-danger">
                      <IconWarning className="h-3 w-3" /> {fieldErrors.monthlyLimit}
                    </div>
                  ) : null}
                </div>
                <div>
                  <label className="text-sm font-medium text-cm-fg" htmlFor="perUser">
                    Per member monthly limit
                  </label>
                  <p className="text-xs text-cm-muted">
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
                    className={INPUT_CLS}
                  />
                  {fieldErrors.perUserMonthlyLimit ? (
                    <div className="mt-1 inline-flex items-center gap-1 text-xs text-cm-danger">
                      <IconWarning className="h-3 w-3" /> {fieldErrors.perUserMonthlyLimit}
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center justify-between pt-2">
                  <div className="text-xs text-cm-muted">
                    {data.policy.updatedAt > 0
                      ? `Updated ${new Date(data.policy.updatedAt).toLocaleString()} by ${data.policy.updatedBy ?? 'unknown'}`
                      : 'Never updated (using defaults)'}
                  </div>
                  <button
                    onClick={() => void save()}
                    disabled={saving}
                    className="inline-flex items-center gap-1 rounded-md bg-cm-fg px-3 py-1.5 text-sm font-medium text-cm-bg hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? <Spinner /> : <IconCheck className="h-4 w-4" />}
                    Save policy
                  </button>
                </div>
                {savedAt ? (
                  <div className="inline-flex items-center gap-1.5 rounded-md border border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] px-2.5 py-1 text-xs text-cm-success">
                    <IconCheck className="h-3 w-3" /> Saved {new Date(savedAt).toLocaleTimeString()}
                  </div>
                ) : null}
              </div>
            </section>

            <p className="text-xs text-cm-muted">
              Mutations to this policy are recorded in the audit chain and require MFA step-up
              for the workspace owner.
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
