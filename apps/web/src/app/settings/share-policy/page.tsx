'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, type SharePolicy, type SharePolicyLimits, ApiError } from '@/lib/api';
import {
  ErrorState,
  Spinner,
  IconArrowRight,
  IconCheck,
  IconShield,
  IconWarning,
} from '@clawmind/ui';

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

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-3 text-sm text-muted-foreground">
          <Link href="/settings" className="hover:text-foreground">Settings</Link>
          <IconArrowRight size={14} />
          <span className="text-foreground">Public share policy</span>
        </div>

        <header className="mb-8">
          <div className="flex items-start gap-3">
            <IconShield size={28} className="mt-1 text-primary" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Public share policy</h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Govern how members mint public share links. Disable sharing entirely, require an
                explicit expiry, or cap the maximum link lifetime across the workspace.
              </p>
            </div>
          </div>
        </header>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading policy
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : policy && limits ? (
          <form
            onSubmit={save}
            className="space-y-6 rounded-lg border bg-card p-6 shadow-sm"
          >
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={disableShares}
                onChange={(e) => setDisableShares(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-input"
              />
              <span>
                <span className="block text-sm font-medium">Disable public sharing</span>
                <span className="block text-xs text-muted-foreground">
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
                className="mt-1 h-4 w-4 rounded border-input"
              />
              <span>
                <span className="block text-sm font-medium">Require an expiry</span>
                <span className="block text-xs text-muted-foreground">
                  Reject requests that ask for a non-expiring link. Every minted share will carry
                  a wall-clock expiry visible to the recipient.
                </span>
              </span>
            </label>

            <div className="space-y-2">
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
                className="w-32 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                0 means no extra cap beyond the platform ceiling of {limits.maxTtlDays} days.
                Otherwise members cannot mint a link longer than this value.
              </p>
            </div>

            {actionError ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <IconWarning size={16} />
                <span>{actionError}</span>
              </div>
            ) : null}

            <div className="flex items-center justify-between border-t pt-4">
              <p className="text-xs text-muted-foreground">
                Last updated by{' '}
                <span className="font-mono">{policy.updatedBy ?? 'never set'}</span> on{' '}
                {fmtDate(policy.updatedAt)}.
              </p>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? <Spinner /> : <IconCheck size={16} />}
                Save policy
              </button>
            </div>

            {savedAt ? (
              <p className="text-xs text-muted-foreground">Saved {fmtDate(savedAt)}.</p>
            ) : null}
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">No policy returned.</p>
        )}
      </main>
    </div>
  );
}
