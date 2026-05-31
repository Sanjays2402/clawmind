'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  type NotificationKind,
  type NotificationPreferences,
} from '@/lib/api';
import {
  ErrorState,
  Spinner,
  IconBell,
  IconCheck,
  IconLink,
  IconWebhook,
  IconSpark,
  IconSettings,
  IconArrowRight,
} from '@clawmind/ui';

interface KindMeta {
  kind: NotificationKind;
  label: string;
  description: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
}

const KINDS: KindMeta[] = [
  {
    kind: 'share.viewed',
    label: 'Share views',
    description: 'When someone opens one of your public share links.',
    Icon: IconLink,
  },
  {
    kind: 'webhook.failed',
    label: 'Webhook failures',
    description: 'When a webhook delivery returns a non-2xx response.',
    Icon: IconWebhook,
  },
  {
    kind: 'webhook.disabled',
    label: 'Webhook auto-disabled',
    description: 'When a webhook is disabled after repeated failures.',
    Icon: IconWebhook,
  },
  {
    kind: 'system',
    label: 'System messages',
    description: 'Maintenance, lifecycle, and account notices from the service.',
    Icon: IconSpark,
  },
];

export default function NotificationPreferencesPage() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKind, setSavingKind] = useState<NotificationKind | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getNotificationPreferences();
      setPrefs(res.preferences);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (kind: NotificationKind, next: boolean) => {
    if (!prefs) return;
    setSavingKind(kind);
    setError(null);
    const optimistic: NotificationPreferences = {
      ...prefs,
      prefs: { ...prefs.prefs, [kind]: next },
    };
    setPrefs(optimistic);
    try {
      const res = await api.updateNotificationPreferences({ [kind]: next });
      setPrefs(res.preferences);
      setSavedAt(Date.now());
    } catch (err) {
      setPrefs(prefs);
      setError((err as Error).message);
    } finally {
      setSavingKind(null);
    }
  };

  const enabledCount = prefs
    ? KINDS.filter((k) => prefs.prefs[k.kind] !== false).length
    : 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="rounded-md border bg-muted/30 p-2 text-primary">
              <IconBell size={22} />
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Notification preferences
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose which kinds of notifications land in your inbox. Switching one
                off stops new ones the moment you save. Past notifications are not
                deleted.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Link
              href="/notifications"
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 hover:bg-muted/50"
            >
              Open inbox
              <IconArrowRight size={14} />
            </Link>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 hover:bg-muted/50"
            >
              <IconSettings size={14} />
              Settings
            </Link>
          </div>
        </header>

        {loading && (
          <div className="rounded-lg border bg-card p-4">
            <ul className="divide-y">
              {KINDS.map((k) => (
                <li key={k.kind} className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-3">
                    <span className="size-8 animate-pulse rounded-md bg-muted" />
                    <div className="space-y-2">
                      <span className="block h-3 w-32 animate-pulse rounded bg-muted" />
                      <span className="block h-3 w-56 animate-pulse rounded bg-muted/70" />
                    </div>
                  </div>
                  <span className="h-6 w-11 animate-pulse rounded-full bg-muted" />
                </li>
              ))}
            </ul>
          </div>
        )}

        {!loading && error && (
          <ErrorState
            title="Could not load preferences"
            message={error}
            onRetry={load}
          />
        )}

        {!loading && !error && prefs && (
          <>
            <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {enabledCount} of {KINDS.length} enabled
              </span>
              {savedAt !== null && (
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <IconCheck size={14} />
                  Saved
                </span>
              )}
            </div>
            <div className="rounded-lg border bg-card">
              <ul className="divide-y">
                {KINDS.map((k) => {
                  const enabled = prefs.prefs[k.kind] !== false;
                  const saving = savingKind === k.kind;
                  const id = `pref-${k.kind}`;
                  return (
                    <li key={k.kind} className="flex items-start gap-3 p-4 sm:items-center">
                      <span className="mt-0.5 shrink-0 rounded-md border bg-muted/30 p-2 text-muted-foreground sm:mt-0">
                        <k.Icon size={18} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <label
                          htmlFor={id}
                          className="block cursor-pointer text-sm font-medium"
                        >
                          {k.label}
                        </label>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {k.description}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {saving && <Spinner size={14} />}
                        <button
                          id={id}
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          aria-label={`${enabled ? 'Disable' : 'Enable'} ${k.label.toLowerCase()}`}
                          disabled={saving}
                          onClick={() => toggle(k.kind, !enabled)}
                          className={[
                            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors',
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                            'disabled:cursor-not-allowed disabled:opacity-60',
                            enabled
                              ? 'bg-primary border-primary'
                              : 'bg-muted border-border',
                          ].join(' ')}
                        >
                          <span
                            className={[
                              'inline-block size-5 transform rounded-full bg-background shadow transition-transform',
                              enabled ? 'translate-x-5' : 'translate-x-0.5',
                            ].join(' ')}
                          />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
              These preferences only affect new notifications. Open the{' '}
              <Link href="/notifications" className="underline hover:text-foreground">
                inbox
              </Link>{' '}
              to manage existing ones, or revisit this page anytime from{' '}
              <Link href="/settings" className="underline hover:text-foreground">
                Settings
              </Link>
              .
            </p>
          </>
        )}
      </main>
    </div>
  );
}
