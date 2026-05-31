'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  API_BASE,
  type OnboardingProgress,
  type OnboardingRecord,
  type OnboardingStep,
} from '@/lib/api';
import {
  Card,
  EmptyState,
  ErrorState,
  Spinner,
  IconSpark,
  IconDatabase,
  IconChat,
  IconKey,
  IconCheck,
  IconArrowRight,
  IconRefresh,
} from '@clawmind/ui';

// /welcome is the three-step first-run guide. It is intentionally tiny:
// every step is a real product action (ingest, ask, create a key) so the
// user finishes onboarding with a live, working setup instead of a tour.
//
// State is held server-side in /v1/onboarding so a user who finishes the
// flow on their laptop sees a clean home page on their phone.

interface StepDef {
  id: OnboardingStep;
  title: string;
  blurb: string;
  cta: string;
  href: string;
  Icon: typeof IconDatabase;
}

const STEPS: StepDef[] = [
  {
    id: 'ingest',
    title: 'Ingest your first source',
    blurb:
      'Point ClawMind at a folder of markdown, code, or notes. The bundled sample pack works if you just want to try it.',
    cta: 'Ingest sample pack',
    href: '/ingest',
    Icon: IconDatabase,
  },
  {
    id: 'ask',
    title: 'Ask your first question',
    blurb:
      'Run a real query against your index. Answers include cited sources so you can click through to the original chunk.',
    cta: 'Open Ask',
    href: '/chat',
    Icon: IconChat,
  },
  {
    id: 'configure',
    title: 'Create an API key',
    blurb:
      'Issue a scoped key so you can call /v1/ask from a script or webhook. Keys can be rotated or revoked any time.',
    cta: 'Manage API keys',
    href: '/keys',
    Icon: IconKey,
  },
];

const SAMPLE_ROOT = 'samples';

export default function WelcomePage() {
  const [record, setRecord] = useState<OnboardingRecord | null>(null);
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);
  const [seedErr, setSeedErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.onboarding();
      setRecord(res.record);
      setProgress(res.progress);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Sign in to start the welcome guide.');
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

  const onSeed = async () => {
    setSeeding(true);
    setSeedMsg(null);
    setSeedErr(null);
    try {
      const res = await fetch(`${API_BASE}/v1/ingest`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root: SAMPLE_ROOT, watch: false }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `ingest failed (${res.status})`);
      }
      const data = (await res.json()) as {
        added?: number;
        updated?: number;
        removed?: number;
      };
      setSeedMsg(
        `Indexed ${data.added ?? 0} added, ${data.updated ?? 0} updated, ${data.removed ?? 0} removed.`,
      );
      await load();
    } catch (err) {
      setSeedErr(err instanceof Error ? err.message : 'ingest failed');
    } finally {
      setSeeding(false);
    }
  };

  const onSkip = async () => {
    try {
      const res = await api.onboardingDismiss();
      setRecord(res.record);
      setProgress(res.progress);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to dismiss');
    }
  };

  const onReset = async () => {
    try {
      const res = await api.onboardingReset();
      setRecord(res.record);
      setProgress(res.progress);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to reset');
    }
  };

  const done = progress?.done ?? 0;
  const total = progress?.total ?? STEPS.length;
  const allDone = total > 0 && done >= total;
  const pct = Math.round((done / Math.max(1, total)) * 100);

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconSpark size={22} />
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Welcome</h1>
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
        </header>

        <p className="mb-6 text-sm text-[var(--fg-muted)]">
          Three small steps and you have a working private RAG setup. Each step does the real
          thing, no demo data.
        </p>

        {loading ? (
          <div className="flex h-40 items-center justify-center" role="status" aria-live="polite">
            <Spinner />
          </div>
        ) : error ? (
          <ErrorState title="Could not load welcome state" message={error} onRetry={load} />
        ) : !record || !progress ? (
          <EmptyState title="Nothing here yet" body="Try refreshing in a moment." />
        ) : (
          <div className="space-y-6">
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="font-medium">
                  {done} of {total} complete
                </span>
                <span className="text-[var(--fg-muted)]" aria-hidden="true">
                  {pct}%
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={done}
                aria-label="Onboarding progress"
                className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-elev)]"
              >
                <div
                  className="h-full bg-[var(--accent,#22c55e)] transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {allDone ? (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 text-sm text-[var(--fg)]">
                    <IconCheck size={14} /> You are all set.
                  </span>
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--bg-elev)]"
                  >
                    Go to dashboard <IconArrowRight size={14} />
                  </Link>
                </div>
              ) : null}
            </Card>

            <ol className="space-y-3">
              {STEPS.map((step, idx) => {
                const completedAt = record.steps[step.id];
                const isDone = completedAt != null;
                const isNext = !isDone && progress.next === step.id;
                const Icon = step.Icon;
                return (
                  <li key={step.id}>
                    <Card
                      className={`p-4 sm:p-5 ${isNext ? 'ring-1 ring-[var(--accent,#22c55e)]' : ''}`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${
                            isDone
                              ? 'border-transparent bg-[var(--accent,#22c55e)] text-white'
                              : 'border-[var(--border)] text-[var(--fg-muted)]'
                          }`}
                          aria-hidden="true"
                        >
                          {isDone ? <IconCheck size={16} /> : <Icon size={16} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-mono text-[var(--fg-muted)]">
                              Step {idx + 1}
                            </span>
                            <h2 className="text-base font-semibold">{step.title}</h2>
                            {isDone ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-elev)] px-2 py-0.5 text-xs text-[var(--fg-muted)]">
                                <IconCheck size={12} /> Done
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm text-[var(--fg-muted)]">{step.blurb}</p>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <Link
                              href={step.href}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-1.5 text-sm hover:bg-[var(--bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                            >
                              {step.cta} <IconArrowRight size={14} />
                            </Link>
                            {step.id === 'ingest' && !isDone ? (
                              <button
                                type="button"
                                onClick={onSeed}
                                disabled={seeding}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent,#22c55e)] bg-[var(--accent,#22c55e)] px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50"
                              >
                                {seeding ? <Spinner /> : <IconDatabase size={14} />}
                                {seeding ? 'Indexing sample pack…' : 'Index sample pack now'}
                              </button>
                            ) : null}
                          </div>
                          {step.id === 'ingest' && seedMsg ? (
                            <p className="mt-2 text-xs text-[var(--fg-muted)]">{seedMsg}</p>
                          ) : null}
                          {step.id === 'ingest' && seedErr ? (
                            <p className="mt-2 text-xs text-red-500">{seedErr}</p>
                          ) : null}
                        </div>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ol>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4 text-sm text-[var(--fg-muted)]">
              <div>
                {record.dismissed
                  ? 'This guide is hidden on the home page.'
                  : 'You can hide this guide once you are comfortable.'}
              </div>
              <div className="flex gap-2">
                {record.dismissed ? (
                  <button
                    type="button"
                    onClick={onReset}
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--bg-elev)]"
                  >
                    Show on home
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onSkip}
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--bg-elev)]"
                  >
                    Hide from home
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
