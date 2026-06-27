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
  SettingsCardSkeleton,
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
    <div className="min-h-screen bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="rounded-md border border-cm-border bg-cm-subtle p-2 text-cm-accent">
              <IconBell size={22} />
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Notification preferences
              </h1>
              <p className="mt-1 text-sm text-cm-muted">
                Choose which kinds of notifications land in your inbox. Switching one
                off stops new ones the moment you save. Past notifications are not
                deleted.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-cm-muted">
            <Link
              href="/notifications"
              className="inline-flex items-center gap-1 rounded-md border border-cm-border px-2.5 py-1.5 hover:bg-cm-subtle"
            >
              Open inbox
              <IconArrowRight size={14} />
            </Link>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1 rounded-md border border-cm-border px-2.5 py-1.5 hover:bg-cm-subtle"
            >
              <IconSettings size={14} />
              Settings
            </Link>
          </div>
        </header>

        {loading && <SettingsCardSkeleton rows={4} />}

        {!loading && error && (
          <ErrorState
            title="Could not load preferences"
            message={error}
            onRetry={load}
          />
        )}

        {!loading && !error && prefs && (
          <>
            <div className="mb-3 flex items-center justify-between text-xs text-cm-muted">
              <span>
                {enabledCount} of {KINDS.length} enabled
              </span>
              {savedAt !== null && (
                <span className="inline-flex items-center gap-1 text-[var(--cm-success)]">
                  <IconCheck size={14} />
                  Saved
                </span>
              )}
            </div>
            <div className="rounded-lg border border-cm-border bg-cm-paper">
              <ul className="divide-y divide-cm-border">
                {KINDS.map((k) => {
                  const enabled = prefs.prefs[k.kind] !== false;
                  const saving = savingKind === k.kind;
                  const id = `pref-${k.kind}`;
                  return (
                    <li key={k.kind} className="flex items-start gap-3 p-4 sm:items-center">
                      <span className="mt-0.5 shrink-0 rounded-md border border-cm-border bg-cm-subtle p-2 text-cm-muted sm:mt-0">
                        <k.Icon size={18} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <label
                          htmlFor={id}
                          className="block cursor-pointer text-sm font-medium"
                        >
                          {k.label}
                        </label>
                        <p className="mt-0.5 text-xs text-cm-muted">
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
                          style={
                            enabled
                              ? { background: 'var(--cm-accent)', borderColor: 'var(--cm-accent)' }
                              : undefined
                          }
                          className={[
                            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors',
                            'disabled:cursor-not-allowed disabled:opacity-60',
                            enabled ? '' : 'bg-cm-subtle border-cm-border',
                          ].join(' ')}
                        >
                          <span
                            className={[
                              'inline-block size-5 transform rounded-full bg-cm-paper shadow transition-transform',
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

            <p className="mt-4 text-xs text-cm-muted">
              These preferences only affect new notifications. Open the{' '}
              <Link href="/notifications" className="underline hover:text-cm-fg">
                inbox
              </Link>{' '}
              to manage existing ones, or revisit this page anytime from{' '}
              <Link href="/settings" className="underline hover:text-cm-fg">
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
