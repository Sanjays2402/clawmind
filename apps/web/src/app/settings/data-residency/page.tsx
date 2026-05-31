'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  type DataResidencyPolicy,
  type Region,
  ApiError,
} from '@/lib/api';
import {
  ErrorState,
  Spinner,
  IconArrowRight,
  IconCheck,
  IconRefresh,
  IconShield,
  IconWarning,
} from '@clawmind/ui';

const REGION_LABEL: Record<Region, string> = {
  us: 'United States',
  eu: 'European Union',
  uk: 'United Kingdom',
  ca: 'Canada',
  au: 'Australia',
  ap: 'Asia-Pacific',
  other: 'Other',
};

function fmtDate(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

export default function DataResidencyPage() {
  const [policy, setPolicy] = useState<DataResidencyPolicy | null>(null);
  const [serverRegion, setServerRegion] = useState<Region | null>(null);
  const [knownRegions, setKnownRegions] = useState<readonly Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<Region>>(new Set());
  const [controller, setController] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.dataResidencyGet();
      setPolicy(res.policy);
      setServerRegion(res.serverRegion);
      setKnownRegions(res.knownRegions);
      setSelected(new Set(res.policy.allowedRegions));
      setController(res.policy.controller);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You need admin or owner access to view the data residency policy.');
      } else if (err instanceof ApiError && err.status === 401) {
        setError('Sign in to view the data residency policy.');
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

  const toggle = (r: Region) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  };

  const orderedSelected = useMemo<Region[]>(
    () => knownRegions.filter((r) => selected.has(r)),
    [knownRegions, selected],
  );

  const wouldLockOut =
    orderedSelected.length > 0 &&
    serverRegion !== null &&
    !orderedSelected.includes(serverRegion);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setSaving(true);
    try {
      const res = await api.dataResidencySet({
        allowedRegions: orderedSelected,
        controller: controller.trim(),
      });
      setPolicy(res.policy);
      setServerRegion(res.serverRegion);
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

  const clearAll = async () => {
    if (
      !window.confirm(
        'Remove all region restrictions? Writes from any region the workspace can reach will be accepted.',
      )
    ) {
      return;
    }
    setActionError(null);
    setSaving(true);
    try {
      const res = await api.dataResidencySet({ allowedRegions: [], controller: controller.trim() });
      setPolicy(res.policy);
      setServerRegion(res.serverRegion);
      setSelected(new Set());
      setSavedAt(Date.now());
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'clear failed';
      setActionError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <header className="mb-8">
          <div className="mb-1 flex items-center gap-2 text-xs text-foreground/60">
            <Link href="/settings" className="hover:text-foreground">
              Settings
            </Link>
            <IconArrowRight className="h-3 w-3" />
            <span>Data residency</span>
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <IconShield className="h-6 w-6 text-foreground/80" />
            Data residency
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-foreground/70">
            Restrict where this workspace's writes may land. The API rejects
            mutating requests with HTTP 451 when the connected server's region
            is not in the allow list. Reads are never blocked. The current
            server region is also returned on every response as the
            <code className="mx-1 rounded bg-foreground/5 px-1 py-0.5 text-[11px]">x-clawmind-region</code>
            header.
          </p>
        </header>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-foreground/60">
            <Spinner /> Loading policy
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !policy || !serverRegion ? (
          <ErrorState message="Policy unavailable" onRetry={load} />
        ) : (
          <form onSubmit={save} className="space-y-8">
            <section className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wide text-foreground/50">
                    Current server region
                  </div>
                  <div className="mt-1 text-base font-medium">
                    {REGION_LABEL[serverRegion]}{' '}
                    <span className="text-foreground/50">({serverRegion})</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={load}
                  className="inline-flex items-center gap-1 rounded-md border border-foreground/15 px-2.5 py-1.5 text-xs text-foreground/70 hover:bg-foreground/5"
                >
                  <IconRefresh className="h-3.5 w-3.5" /> Refresh
                </button>
              </div>
              <div className="mt-3 text-xs text-foreground/60">
                Last updated {fmtDate(policy.updatedAt)}
                {policy.updatedBy ? ` by ${policy.updatedBy}` : ''}.
              </div>
            </section>

            <section>
              <h2 className="text-sm font-medium">Allowed regions</h2>
              <p className="mt-1 text-xs text-foreground/60">
                Select every region the workspace is permitted to land writes
                in. Leave empty to accept writes from any region the
                deployment can reach.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {knownRegions.map((r) => {
                  const checked = selected.has(r);
                  return (
                    <label
                      key={r}
                      className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors ${
                        checked
                          ? 'border-foreground/40 bg-foreground/[0.04]'
                          : 'border-foreground/10 hover:border-foreground/25'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={checked}
                        onChange={() => toggle(r)}
                      />
                      <span className="flex-1">
                        <span className="font-medium">{REGION_LABEL[r]}</span>
                        <span className="ml-2 text-xs text-foreground/50">{r}</span>
                        {r === serverRegion ? (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-sm bg-foreground/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-foreground/70">
                            this server
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
              {wouldLockOut ? (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-200">
                  <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    Saving this policy will reject writes from the connected
                    server ({REGION_LABEL[serverRegion]}). Reads and
                    /v1/data-residency itself will still work, so you can
                    relax the policy from this page.
                  </div>
                </div>
              ) : null}
            </section>

            <section>
              <h2 className="text-sm font-medium">Data controller</h2>
              <p className="mt-1 text-xs text-foreground/60">
                Free-text hint surfaced in the GET response so a customer DPA
                can quote a stable value. Up to 200 characters.
              </p>
              <input
                type="text"
                maxLength={200}
                value={controller}
                onChange={(e) => setController(e.target.value)}
                placeholder="e.g. Acme GmbH, Frankfurt"
                className="mt-2 w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-sm focus:border-foreground/40 focus:outline-none"
              />
            </section>

            {actionError ? (
              <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/5 p-3 text-xs text-red-700 dark:text-red-300">
                <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{actionError}</span>
              </div>
            ) : null}

            {savedAt ? (
              <div className="flex items-center gap-2 text-xs text-foreground/60">
                <IconCheck className="h-4 w-4" /> Saved {fmtDate(savedAt)}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:bg-foreground/90 disabled:opacity-50"
              >
                {saving ? <Spinner /> : <IconCheck className="h-4 w-4" />}
                Save policy
              </button>
              <button
                type="button"
                onClick={clearAll}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-md border border-foreground/15 px-3 py-2 text-sm text-foreground/80 hover:bg-foreground/5 disabled:opacity-50"
              >
                Clear restrictions
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
