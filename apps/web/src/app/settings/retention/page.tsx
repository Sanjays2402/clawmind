'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  type RetentionPolicy,
  type RetentionLimits,
  type RetentionSweepReport,
  ApiError,
} from '@/lib/api';
import {
  ErrorState,
  Spinner,
  IconArrowRight,
  IconCheck,
  IconClockCountdown,
  IconRefresh,
  IconShield,
  IconTrash,
  IconWarning,
} from '@clawmind/ui';

type FieldKey = 'historyDays' | 'conversationDays' | 'auditDays';

interface FieldConfig {
  key: FieldKey;
  label: string;
  hint: string;
}

const FIELDS: FieldConfig[] = [
  {
    key: 'historyDays',
    label: 'Ask history',
    hint: 'Auto-erase /v1/history entries older than this. Blank means keep forever.',
  },
  {
    key: 'conversationDays',
    label: 'Conversations',
    hint: 'Stale conversations (by last update) are deleted on the next sweep.',
  },
  {
    key: 'auditDays',
    label: 'Audit log (reporting hint)',
    hint: 'Stored for compliance reporting. The audit chain is never silently truncated.',
  },
];

function toInputValue(n: number | null): string {
  return n === null || n === undefined ? '' : String(n);
}

function parseField(raw: string): number | null | 'invalid' {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isInteger(n)) return 'invalid';
  return n;
}

function fmtDate(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

export default function RetentionPage() {
  const [policy, setPolicy] = useState<RetentionPolicy | null>(null);
  const [limits, setLimits] = useState<RetentionLimits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<Record<FieldKey, string>>({
    historyDays: '',
    conversationDays: '',
    auditDays: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [preview, setPreview] = useState<RetentionSweepReport | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [lastReport, setLastReport] = useState<RetentionSweepReport | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.retentionGet();
      setPolicy(res.policy);
      setLimits(res.limits);
      setDraft({
        historyDays: toInputValue(res.policy.historyDays),
        conversationDays: toInputValue(res.policy.conversationDays),
        auditDays: toInputValue(res.policy.auditDays),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const validate = (): { ok: boolean; patch: Record<FieldKey, number | null> } => {
    const out: Record<FieldKey, number | null> = {
      historyDays: null,
      conversationDays: null,
      auditDays: null,
    };
    const errs: Partial<Record<FieldKey, string>> = {};
    for (const f of FIELDS) {
      const parsed = parseField(draft[f.key]);
      if (parsed === 'invalid') {
        errs[f.key] = 'must be a whole number of days';
        continue;
      }
      if (parsed !== null && limits) {
        if (parsed < limits.minDays || parsed > limits.maxDays) {
          errs[f.key] = `must be between ${limits.minDays} and ${limits.maxDays}`;
          continue;
        }
      }
      out[f.key] = parsed;
    }
    setFieldErrors(errs);
    return { ok: Object.keys(errs).length === 0, patch: out };
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    const { ok, patch } = validate();
    if (!ok) return;
    setSaving(true);
    try {
      const next = await api.retentionPut(patch);
      setPolicy(next);
      setSavedAt(Date.now());
      setPreview(null);
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

  const runPreview = async () => {
    setActionError(null);
    setPreviewing(true);
    try {
      const r = await api.retentionApply(true);
      setPreview(r);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const runApply = async () => {
    if (!preview) return;
    const total = preview.history.removed + preview.conversations.removed;
    if (total === 0) return;
    if (!window.confirm(`Permanently delete ${total} record(s)? This cannot be undone.`)) return;
    setActionError(null);
    setApplying(true);
    try {
      const r = await api.retentionApply(false);
      setLastReport(r);
      setPreview(null);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'apply failed');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconClockCountdown size={22} />
            <div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Data retention</h1>
              <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
                Cap how long ClawMind keeps your records. Required by most compliance reviews.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--fg-muted)] hover:bg-[var(--bg-elev)] disabled:opacity-50"
            aria-label="Refresh"
          >
            <IconRefresh size={14} />
            Refresh
          </button>
        </div>

        {loading && !policy ? (
          <div className="flex items-center gap-2 text-sm text-[var(--fg-muted)]">
            <Spinner /> Loading policy
          </div>
        ) : error ? (
          <ErrorState title="Could not load retention policy" message={error} onRetry={load} />
        ) : policy && limits ? (
          <div className="grid gap-6">
            <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--fg)]">Policy</h2>
                  <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
                    Values are in days. Leave blank to keep forever.
                  </p>
                </div>
                <span className="text-xs text-[var(--fg-muted)]">
                  Last sweep: {fmtDate(policy.lastSweepAt)}
                </span>
              </div>

              <form onSubmit={save} className="grid gap-4 text-sm">
                {FIELDS.map((f) => (
                  <label key={f.key} className="grid gap-1">
                    <span className="font-medium text-[var(--fg)]">{f.label}</span>
                    <span className="text-xs text-[var(--fg-muted)]">{f.hint}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={limits.minDays}
                        max={limits.maxDays}
                        step={1}
                        placeholder="forever"
                        value={draft[f.key]}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [f.key]: e.target.value }))
                        }
                        className="w-32 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--fg)] outline-none focus:border-[var(--fg-muted)]"
                        aria-invalid={fieldErrors[f.key] ? true : undefined}
                      />
                      <span className="text-xs text-[var(--fg-muted)]">days</span>
                    </div>
                    {fieldErrors[f.key] ? (
                      <span className="text-xs text-red-500">{fieldErrors[f.key]}</span>
                    ) : null}
                  </label>
                ))}

                <div className="mt-2 flex items-center justify-between gap-3">
                  {savedAt ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--fg-muted)]">
                      <IconCheck size={12} /> Saved
                    </span>
                  ) : (
                    <span />
                  )}
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--fg)] px-3 py-1.5 text-sm font-medium text-[var(--bg)] hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? <Spinner /> : <IconCheck size={14} />} Save policy
                  </button>
                </div>
              </form>
            </section>

            <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-5">
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-[var(--fg)]">Sweep now</h2>
                <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
                  Preview what the current policy would remove, then apply.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={runPreview}
                  disabled={previewing || applying}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--fg)] hover:bg-[var(--bg)] disabled:opacity-50"
                >
                  {previewing ? <Spinner /> : <IconShield size={14} />} Preview (dry run)
                </button>
                <button
                  type="button"
                  onClick={runApply}
                  disabled={
                    !preview ||
                    applying ||
                    previewing ||
                    preview.history.removed + preview.conversations.removed === 0
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/20 disabled:opacity-50"
                >
                  {applying ? <Spinner /> : <IconTrash size={14} />} Apply and delete
                </button>
              </div>

              {actionError ? (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-500">
                  <IconWarning size={14} /> {actionError}
                </div>
              ) : null}

              {preview ? (
                <ReportPanel report={preview} variant="preview" />
              ) : lastReport ? (
                <ReportPanel report={lastReport} variant="applied" />
              ) : null}
            </section>

            <Link
              href="/settings"
              className="inline-flex items-center gap-1.5 text-sm text-[var(--fg-muted)] hover:text-[var(--fg)]"
            >
              Back to settings <IconArrowRight size={12} />
            </Link>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function ReportPanel({
  report,
  variant,
}: {
  report: RetentionSweepReport;
  variant: 'preview' | 'applied';
}) {
  const total = report.history.removed + report.conversations.removed;
  return (
    <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-[var(--fg)]">
          {variant === 'preview' ? 'Would remove' : 'Removed'}
        </span>
        <span className="text-xs text-[var(--fg-muted)]">
          {variant === 'preview' ? 'No data was changed' : `at ${new Date().toLocaleTimeString()}`}
        </span>
      </div>
      <dl className="grid gap-1.5 text-xs">
        <div className="flex justify-between">
          <dt className="text-[var(--fg-muted)]">Ask history</dt>
          <dd className="text-[var(--fg)]">
            {report.history.removed} removed, {report.history.kept} kept
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--fg-muted)]">Conversations</dt>
          <dd className="text-[var(--fg)]">
            {report.conversations.removed} removed, {report.conversations.kept} kept
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--fg-muted)]">Audit retention hint</dt>
          <dd className="text-[var(--fg)]">
            {report.auditDays === null ? 'forever' : `${report.auditDays} days`}
          </dd>
        </div>
      </dl>
      {total === 0 ? (
        <p className="mt-2 text-xs text-[var(--fg-muted)]">Nothing to remove right now.</p>
      ) : null}
    </div>
  );
}
