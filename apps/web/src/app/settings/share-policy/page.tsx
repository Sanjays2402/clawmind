'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, type SharePolicy, type SharePolicyLimits, ApiError } from '@/lib/api';
import {
  ErrorState,
  SettingsCardSkeleton,
  Spinner,
  IconArrowRight,
  IconCheck,
  IconShield,
  IconWarning,
} from '@clawmind/ui';

// Shared control styling: theme-aware surface + brand focus ring.
const INPUT_CLS =
  'rounded-md border border-cm-border bg-cm-bg px-3 py-1.5 text-sm text-cm-fg outline-none placeholder:text-cm-faint focus:ring-2 focus:ring-cm-accent';

function fmtDate(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

export default function SharePolicyPage() {
  const [policy, setPolicy] = useState<SharePolicy | null>(null);
  const [limits, setLimits] = useState<SharePolicyLimits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [disableShares, setDisableShares] = useState(false);
  const [requireExpiry, setRequireExpiry] = useState(false);
  const [maxTtlDays, setMaxTtlDays] = useState(0);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.sharePolicyGet();
      setPolicy(res.policy);
      setLimits(res.limits);
      setDisableShares(res.policy.disableShares);
      setRequireExpiry(res.policy.requireExpiry);
      setMaxTtlDays(res.policy.maxTtlDays);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You need admin or owner access to view the share policy.');
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
    setActionError(null);
    setSaving(true);
    try {
      const next = await api.sharePolicySet({
        disableShares,
        requireExpiry,
        maxTtlDays,
      });
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

  // Share-governance posture from the live toggle matrix. Off entirely is the
  // most restrictive (no new public links can be minted) -> success. Allowed
  // but constrained by a required expiry and/or a TTL cap -> accent (governed).
  // Allowed with no expiry and no cap -> muted (the default-open posture).
  const posture: 'off' | 'governed' | 'open' = disableShares
    ? 'off'
    : requireExpiry || maxTtlDays > 0
      ? 'governed'
      : 'open';

  const constraints = useMemo(() => {
    const out: string[] = [];
    if (requireExpiry) out.push('every link must carry an expiry');
    if (maxTtlDays > 0) out.push(`links cannot outlive ${maxTtlDays} ${maxTtlDays === 1 ? 'day' : 'days'}`);
    return out;
  }, [requireExpiry, maxTtlDays]);

  return (
    <div className="min-h-screen bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-3 text-sm text-cm-muted">
          <Link href="/settings" className="hover:text-cm-fg">Settings</Link>
          <IconArrowRight size={14} />
          <span className="text-cm-fg">Public share policy</span>
        </div>

        <header className="mb-8">
          <div className="flex items-start gap-3">
            <IconShield size={28} className="mt-1 text-cm-accent" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Public share policy</h1>
              <p className="mt-1 max-w-xl text-sm text-cm-muted">
                Govern how members mint public share links. Disable sharing entirely, require an
                explicit expiry, or cap the maximum link lifetime across the workspace.
              </p>
            </div>
          </div>
        </header>

        {loading ? (
          <SettingsCardSkeleton rows={3} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : policy && limits ? (
          <form
            onSubmit={save}
            className="space-y-6 rounded-lg border border-cm-border bg-cm-paper p-6 shadow-sm"
          >
            {/* Live governance posture for the whole workspace. */}
            {posture === 'off' && (
              <div className="flex items-start gap-2 rounded-md border border-[var(--cm-success)] bg-[rgba(47,122,85,0.10)] p-3 text-xs text-cm-success">
                <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Sharing is off. Every new POST /v1/share is rejected and audit logged.
                  Existing links keep working until revoked or they expire.
                </span>
              </div>
            )}
            {posture === 'governed' && (
              <div className="flex items-start gap-2 rounded-md border border-cm-accent-line bg-cm-accent-soft p-3 text-xs text-cm-accent-ink">
                <IconShield className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Sharing is allowed but governed: {constraints.join(' and ')}. Members can mint
                  links within these guardrails.
                </span>
              </div>
            )}
            {posture === 'open' && (
              <div className="flex items-start gap-2 rounded-md border border-cm-cite-line bg-cm-cite-bg p-3 text-xs text-cm-cite">
                <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Open posture: members can mint non-expiring public links with no lifetime cap.
                  Require an expiry or set a cap below to tighten this.
                </span>
              </div>
            )}

            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={disableShares}
                onChange={(e) => setDisableShares(e.target.checked)}
                className="mt-1 h-4 w-4 accent-cm-accent"
              />
              <span>
                <span className="block text-sm font-medium">Disable public sharing</span>
                <span className="block text-xs text-cm-muted">
                  When on, every POST /v1/share is rejected with 403 and audit logged. Existing
                  share links keep working until revoked or expired.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={requireExpiry}
                onChange={(e) => setRequireExpiry(e.target.checked)}
                disabled={disableShares}
                className="mt-1 h-4 w-4 accent-cm-accent disabled:opacity-50"
              />
              <span className={disableShares ? 'opacity-50' : ''}>
                <span className="block text-sm font-medium">Require an expiry</span>
                <span className="block text-xs text-cm-muted">
                  Reject requests that ask for a non-expiring link. Every minted share will carry
                  a wall-clock expiry visible to the recipient.
                </span>
              </span>
            </label>

            <div className={`space-y-2 ${disableShares ? 'opacity-50' : ''}`}>
              <label htmlFor="ttl-cap" className="block text-sm font-medium">
                Maximum link lifetime in days
              </label>
              <input
                id="ttl-cap"
                type="number"
                min={0}
                max={limits.maxTtlDays}
                value={maxTtlDays}
                onChange={(e) => setMaxTtlDays(Number(e.target.value) || 0)}
                disabled={disableShares}
                className={`w-32 ${INPUT_CLS}`}
              />
              <p className="text-xs text-cm-muted">
                0 means no extra cap beyond the platform ceiling of {limits.maxTtlDays} days.
                Otherwise members cannot mint a link longer than this value.
              </p>
            </div>

            {actionError ? (
              <div className="flex items-start gap-2 rounded-md border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] p-3 text-sm text-cm-danger">
                <IconWarning size={16} />
                <span>{actionError}</span>
              </div>
            ) : null}

            <div className="flex items-center justify-between border-t border-cm-border pt-4">
              <p className="text-xs text-cm-muted">
                Last updated by{' '}
                <span className="font-mono">{policy.updatedBy ?? 'never set'}</span> on{' '}
                {fmtDate(policy.updatedAt)}.
              </p>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-md bg-cm-fg px-4 py-2 text-sm font-medium text-cm-bg hover:opacity-90 disabled:opacity-50"
              >
                {saving ? <Spinner /> : <IconCheck size={16} />}
                Save policy
              </button>
            </div>

            {savedAt ? (
              <p className="text-xs text-cm-muted">Saved {fmtDate(savedAt)}.</p>
            ) : null}
          </form>
        ) : (
          <p className="text-sm text-cm-muted">No policy returned.</p>
        )}
      </main>
    </div>
  );
}
