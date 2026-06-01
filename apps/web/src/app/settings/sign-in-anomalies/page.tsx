'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, fmtRelative, type SignInAnomalyRecord, type SignInAnomalyListResult } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconShield,
  IconWarning,
  IconCheck,
  IconRefresh,
} from '@clawmind/ui';

type Scope = 'self' | 'all';

function fmtAbsolute(ts: number): string {
  return new Date(ts).toLocaleString();
}

function StatusBadge({ ack }: { ack: number | null }) {
  if (ack) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
        <IconCheck size={11} /> Acknowledged
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
      <IconWarning size={11} /> Open
    </span>
  );
}

export default function SignInAnomaliesPage() {
  const [scope, setScope] = useState<Scope>('self');
  const [data, setData] = useState<SignInAnomalyListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adminBlocked, setAdminBlocked] = useState(false);
  const [acking, setAcking] = useState<string | null>(null);

  const load = useCallback(
    async (nextScope: Scope = scope) => {
      setLoading(true);
      setError(null);
      try {
        const out = nextScope === 'all'
          ? await api.signInAnomaliesListAll({ limit: 100 })
          : await api.signInAnomaliesList({ limit: 100 });
        setData(out);
        setAdminBlocked(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (nextScope === 'all' && /403|forbidden|admin/i.test(msg)) {
          setAdminBlocked(true);
          setData({ records: [], nextCursor: null, total: 0, openCount: 0 });
        } else {
          setError(msg);
        }
      } finally {
        setLoading(false);
      }
    },
    [scope],
  );

  useEffect(() => { void load(scope); }, [scope, load]);

  const ack = async (id: string) => {
    setAcking(id);
    try {
      await api.signInAnomalyAck(id);
      await load(scope);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAcking(null);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Link href="/settings" className="hover:text-foreground">Settings</Link>
              <span>/</span>
              <span>Sign-in anomalies</span>
            </div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <IconShield size={22} />
              Sign-in anomalies
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Successful sign-ins that imply travel faster than a commercial flight between two countries. Detection is best-effort and never blocks a login; acknowledge a row once you have confirmed the activity.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(scope)}
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm hover:bg-accent"
          >
            <IconRefresh size={14} /> Refresh
          </button>
        </div>

        <div className="mb-4 inline-flex rounded-md border border-input bg-background p-1 text-sm">
          <button
            type="button"
            onClick={() => setScope('self')}
            className={`rounded px-3 py-1 ${scope === 'self' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Your sign-ins
          </button>
          <button
            type="button"
            onClick={() => setScope('all')}
            className={`rounded px-3 py-1 ${scope === 'all' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Workspace (admin)
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Spinner /> <span className="ml-2">Loading anomalies</span>
          </div>
        )}

        {!loading && error && (
          <ErrorState
            title="Could not load anomalies"
            message={error}
            onRetry={() => void load(scope)}
          />
        )}

        {!loading && !error && adminBlocked && (
          <EmptyState
            title="Admin access required"
            body="Switch to your own sign-ins, or ask an owner to grant you the sign-in-anomalies:admin scope."
          />
        )}

        {!loading && !error && !adminBlocked && data && data.records.length === 0 && (
          <EmptyState
            title="No anomalies detected"
            body={scope === 'self'
              ? 'Your recent sign-ins all happened from plausible locations.'
              : 'No workspace sign-in has tripped the impossible-travel detector.'}
          />
        )}

        {!loading && !error && !adminBlocked && data && data.records.length > 0 && (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Showing {data.records.length} of {data.total}. {data.openCount} open across the queue.
            </div>
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {data.records.map((r: SignInAnomalyRecord) => (
                <li key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge ack={r.acknowledgedAt} />
                      <span className="font-mono text-xs text-muted-foreground">{r.actor}</span>
                    </div>
                    <div className="mt-1 text-sm">
                      <span className="font-semibold">{r.previous.country}</span>
                      <span className="text-muted-foreground"> to </span>
                      <span className="font-semibold">{r.current.country}</span>
                      <span className="text-muted-foreground"> in {r.elapsedMinutes} min, implying {r.speedKmh.toLocaleString()} km/h (threshold {r.thresholdKmh})</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {r.previous.ip} via {r.previous.method} at {fmtAbsolute(r.previous.at)} then {r.current.ip} via {r.current.method} at {fmtAbsolute(r.current.at)}
                      {' '}({fmtRelative(r.createdAt)})
                    </div>
                  </div>
                  {!r.acknowledgedAt && (
                    <button
                      type="button"
                      onClick={() => void ack(r.id)}
                      disabled={acking === r.id}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm hover:bg-accent disabled:opacity-50"
                    >
                      <IconCheck size={14} /> {acking === r.id ? 'Acknowledging' : 'Acknowledge'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
