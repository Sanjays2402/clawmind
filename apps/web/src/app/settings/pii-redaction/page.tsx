'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  type PiiRedactionPolicy,
  type PiiBuiltinClass,
  type PiiAction,
  type PiiCustomRule,
} from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconArrowRight,
  IconPlus,
  IconRefresh,
  IconShield,
  IconTrash,
  IconWarning,
} from '@clawmind/ui';

const BUILTIN_CLASSES: PiiBuiltinClass[] = [
  'email',
  'phone',
  'ssn',
  'credit_card',
  'ipv4',
];
const ACTIONS: PiiAction[] = ['off', 'redact', 'block'];

const CLASS_LABEL: Record<PiiBuiltinClass, string> = {
  email: 'Email address',
  phone: 'Phone number',
  ssn: 'US social security number',
  credit_card: 'Credit card (Luhn validated)',
  ipv4: 'IPv4 address',
};

function fmtDate(ts: number): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

interface DraftCustom {
  id?: string;
  label: string;
  pattern: string;
  action: PiiAction;
}

function toDraft(rules: PiiCustomRule[]): DraftCustom[] {
  return rules.map((r) => ({
    id: r.id,
    label: r.label,
    pattern: r.pattern,
    action: r.action,
  }));
}

export default function PiiRedactionPage() {
  const [policy, setPolicy] = useState<PiiRedactionPolicy | null>(null);
  const [builtins, setBuiltins] = useState<Record<PiiBuiltinClass, PiiAction> | null>(
    null,
  );
  const [custom, setCustom] = useState<DraftCustom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await api.piiRedactionGet();
      setPolicy(p);
      setBuiltins({ ...p.builtins });
      setCustom(toDraft(p.custom));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You do not have permission to view the workspace PII redaction policy.');
      } else if (err instanceof ApiError && err.status === 401) {
        setError('Sign in to view the workspace PII redaction policy.');
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

  function updateBuiltin(cls: PiiBuiltinClass, a: PiiAction) {
    if (!builtins) return;
    setBuiltins({ ...builtins, [cls]: a });
  }

  function addCustomRow() {
    setCustom((prev) => [...prev, { label: '', pattern: '', action: 'redact' }]);
  }

  function updateCustom(idx: number, patch: Partial<DraftCustom>) {
    setCustom((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function removeCustom(idx: number) {
    setCustom((prev) => prev.filter((_, i) => i !== idx));
  }

  async function onSave() {
    if (!builtins) return;
    setSaving(true);
    setActionError(null);
    try {
      const cleaned = custom
        .map((r) => ({
          id: r.id,
          label: r.label.trim(),
          pattern: r.pattern,
          action: r.action,
        }))
        .filter((r) => r.label.length > 0 && r.pattern.length > 0);
      const next = await api.piiRedactionPut({ builtins, custom: cleaned });
      setPolicy(next);
      setBuiltins({ ...next.builtins });
      setCustom(toDraft(next.custom));
      setSavedAt(Date.now());
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setActionError(
            'A recent MFA step-up is required to change the policy. Verify on the MFA page and retry.',
          );
        } else if (err.status === 403) {
          setActionError('Only the workspace owner can edit the PII redaction policy.');
        } else if (err.status === 400) {
          const body = err.body as { field?: string; message?: string } | null | undefined;
          const msg = body?.message ?? 'invalid input';
          setActionError(body?.field ? `${msg} (${body.field})` : msg);
        } else {
          const body = err.body as { message?: string } | null | undefined;
          setActionError(body?.message ?? err.message);
        }
      } else {
        setActionError(err instanceof Error ? err.message : 'failed to save');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg text-fg">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-6">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
          >
            <IconArrowRight size={14} className="rotate-180" />
            Settings
          </Link>
        </div>

        <header className="mb-8 flex items-start gap-3">
          <div className="rounded-lg border border-border bg-surface p-2">
            <IconShield size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              PII redaction policy
            </h1>
            <p className="mt-1 text-sm text-fg-muted">
              Detector classes that scrub or block sensitive strings before any query
              reaches retrieval, the audit log, or the LLM provider. Applies to ask,
              ask stream, search, explain, and batch.
            </p>
          </div>
        </header>

        {loading ? (
          <div className="space-y-3" aria-busy="true">
            <div className="h-24 animate-pulse rounded-md border border-border bg-surface" />
            <div className="h-24 animate-pulse rounded-md border border-border bg-surface" />
            <div className="sr-only">
              <Spinner />
              Loading
            </div>
          </div>
        ) : error ? (
          <ErrorState
            title="Could not load policy"
            message={error}
            onRetry={load}
          />
        ) : !builtins || !policy ? null : (
          <>
            <section className="mb-8 rounded-md border border-border bg-surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium">Built-in detectors</h2>
                <span className="text-xs text-fg-muted">
                  Updated {fmtDate(policy.updatedAt)}
                  {policy.updatedBy ? ` by ${policy.updatedBy}` : ''}
                </span>
              </div>
              <p className="mb-3 text-xs text-fg-muted">
                off disables the class. redact rewrites every match with
                [REDACTED:class] before retrieval. block rejects the request with
                422 and never forwards the query.
              </p>
              <ul className="divide-y divide-border">
                {BUILTIN_CLASSES.map((cls) => (
                  <li
                    key={cls}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{CLASS_LABEL[cls]}</div>
                      <div className="text-xs text-fg-muted font-mono">{cls}</div>
                    </div>
                    <div role="radiogroup" aria-label={`Action for ${cls}`} className="flex shrink-0 gap-1">
                      {ACTIONS.map((a) => {
                        const active = builtins[cls] === a;
                        return (
                          <button
                            key={a}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => updateBuiltin(cls, a)}
                            className={
                              'rounded-md border px-2.5 py-1 text-xs ' +
                              (active
                                ? 'border-fg bg-fg text-bg'
                                : 'border-border text-fg-muted hover:text-fg')
                            }
                          >
                            {a}
                          </button>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="mb-8 rounded-md border border-border bg-surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium">Custom rules</h2>
                <button
                  type="button"
                  onClick={addCustomRow}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-fg-muted hover:text-fg"
                >
                  <IconPlus size={14} />
                  Add rule
                </button>
              </div>
              {custom.length === 0 ? (
                <EmptyState
                  title="No custom rules"
                  body="Add a labelled regex to scrub workspace-specific identifiers such as customer codes or internal ticket numbers."
                />
              ) : (
                <ul className="space-y-3">
                  {custom.map((r, idx) => (
                    <li
                      key={r.id ?? `new-${idx}`}
                      className="rounded-md border border-border bg-bg p-3"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <div className="flex-1 min-w-0">
                          <label className="block text-[10px] uppercase tracking-wide text-fg-muted">
                            Label
                          </label>
                          <input
                            value={r.label}
                            onChange={(e) =>
                              updateCustom(idx, { label: e.target.value })
                            }
                            placeholder="acct"
                            maxLength={60}
                            className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-fg"
                          />
                        </div>
                        <div className="flex-[2] min-w-0">
                          <label className="block text-[10px] uppercase tracking-wide text-fg-muted">
                            Regex pattern
                          </label>
                          <input
                            value={r.pattern}
                            onChange={(e) =>
                              updateCustom(idx, { pattern: e.target.value })
                            }
                            placeholder="ACME-\\d{4}"
                            maxLength={500}
                            className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-fg"
                          />
                        </div>
                        <div className="shrink-0">
                          <label className="block text-[10px] uppercase tracking-wide text-fg-muted">
                            Action
                          </label>
                          <select
                            value={r.action}
                            onChange={(e) =>
                              updateCustom(idx, { action: e.target.value as PiiAction })
                            }
                            className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-fg"
                          >
                            {ACTIONS.map((a) => (
                              <option key={a} value={a}>
                                {a}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="text-[11px] text-fg-muted">
                          {r.id ? 'Existing rule' : 'New rule'}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeCustom(idx)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-fg-muted hover:text-fg"
                          aria-label={`Remove rule ${r.label || 'new'}`}
                        >
                          <IconTrash size={14} />
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onSave}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-md border border-fg bg-fg px-3 py-1.5 text-xs font-medium text-bg disabled:opacity-50"
              >
                {saving ? <Spinner /> : null}
                Save policy
              </button>
              <button
                type="button"
                onClick={load}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
              >
                <IconRefresh size={14} />
                Reload
              </button>
              {savedAt ? (
                <span className="text-xs text-fg-muted">
                  Saved {fmtDate(savedAt)}
                </span>
              ) : null}
            </div>
            {actionError ? (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-surface p-2 text-xs text-fg">
                <IconWarning size={14} className="mt-0.5 shrink-0" />
                <span>{actionError}</span>
              </div>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
