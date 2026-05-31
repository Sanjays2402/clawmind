'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, API_BASE, type UsageSummary, type ProfileRecord, ApiError } from '@/lib/api';
import {
  ThemeToggle,
  EmptyState,
  ErrorState,
  Spinner,
  IconSettings,
  IconChartBar,
  IconKey,
  IconWebhook,
  IconDownload,
  IconTrash,
  IconArrowRight,
  IconWarning,
  IconRefresh,
  IconCheck,
  IconPencil,
  IconShield,
} from '@clawmind/ui';

interface HealthSummary {
  embed: boolean;
  llm: boolean;
  docs: number;
  chunks: number;
}

function fmtResetDate(resetsAt: number): string {
  return new Date(resetsAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function SettingsPage() {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, h, p] = await Promise.all([
        api.usage(),
        api.health() as Promise<HealthSummary>,
        api.profileGet().catch(() => null),
      ]);
      setUsage(u);
      setHealth(h);
      setProfile(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconSettings size={22} />
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Settings</h1>
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

        {loading && !usage ? (
          <div className="flex items-center gap-2 text-sm text-[var(--fg-muted)]">
            <Spinner /> Loading account
          </div>
        ) : error ? (
          <ErrorState title="Could not load settings" message={error} onRetry={load} />
        ) : (
          <div className="grid gap-6">
            <ProfileCard
              userId={usage?.userId ?? 'local'}
              plan={usage?.plan ?? 'free'}
              profile={profile}
              onSaved={(next) => setProfile(next)}
            />
            <UsageCard usage={usage} />
            <AppearanceCard />
            <SystemCard health={health} />
            <ShortcutsCard />
            <DataCard onChanged={load} />
          </div>
        )}
      </main>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-5">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-[var(--fg)]">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs text-[var(--fg-muted)]">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function ProfileCard({
  userId,
  plan,
  profile,
  onSaved,
}: {
  userId: string;
  plan: string;
  profile: ProfileRecord | null;
  onSaved: (p: ProfileRecord) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const begin = () => {
    setDisplayName(profile?.displayName ?? userId);
    setTimezone(profile?.timezone ?? 'UTC');
    setDefaultModel(profile?.defaultModel ?? '');
    setErr(null);
    setEditing(true);
  };

  const useLocalTz = () => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) setTimezone(tz);
    } catch {
      // ignore
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const next = await api.profilePatch({
        displayName,
        timezone,
        defaultModel: defaultModel.trim() === '' ? null : defaultModel,
      });
      onSaved(next);
      setSavedAt(Date.now());
      setEditing(false);
    } catch (e2) {
      const msg =
        e2 instanceof ApiError
          ? `${e2.status}: ${e2.message}`
          : e2 instanceof Error
          ? e2.message
          : 'save failed';
      setErr(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title="Profile"
      description="The account every saved item, conversation, and API key is attached to."
    >
      {!editing ? (
        <>
          <dl className="grid gap-2 text-sm">
            <Row label="User ID">
              <code className="cm-mono text-[12px] text-[var(--fg)]">{userId}</code>
            </Row>
            <Row label="Display name">
              <span className="text-[var(--fg)]">{profile?.displayName ?? userId}</span>
            </Row>
            <Row label="Timezone">
              <span className="text-[var(--fg)]">{profile?.timezone ?? 'UTC'}</span>
            </Row>
            <Row label="Default model">
              <span className="text-[var(--fg)]">
                {profile?.defaultModel ?? (
                  <span className="text-[var(--fg-muted)]">server default</span>
                )}
              </span>
            </Row>
            <Row label="Plan">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2 py-0.5 text-[12px] capitalize text-[var(--fg)]">
                {plan}
              </span>
            </Row>
          </dl>
          <div className="mt-4 flex items-center justify-between gap-3">
            {savedAt ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-[var(--fg-muted)]">
                <IconCheck size={12} /> Saved
              </span>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={begin}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--fg)] hover:bg-[var(--bg)]"
            >
              <IconPencil size={14} /> Edit profile
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} className="grid gap-3 text-sm">
          <label className="grid gap-1">
            <span className="text-xs text-[var(--fg-muted)]">Display name</span>
            <input
              type="text"
              required
              maxLength={80}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--fg)] outline-none focus:border-[var(--fg-muted)]"
              autoFocus
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-[var(--fg-muted)]">
              Timezone (IANA, e.g. America/Los_Angeles)
            </span>
            <div className="flex gap-2">
              <input
                type="text"
                required
                maxLength={64}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--fg)] outline-none focus:border-[var(--fg-muted)]"
              />
              <button
                type="button"
                onClick={useLocalTz}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--fg-muted)] hover:bg-[var(--bg)]"
              >
                Use local
              </button>
            </div>
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-[var(--fg-muted)]">
              Default model (leave empty for server default)
            </span>
            <input
              type="text"
              maxLength={80}
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              placeholder="gpt-4o-mini"
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--fg)] outline-none focus:border-[var(--fg-muted)]"
            />
          </label>
          {err ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-xs text-[var(--fg)]">
              <IconWarning size={14} /> <span>{err}</span>
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--fg-muted)] hover:bg-[var(--bg)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--fg)] px-3 py-1.5 text-sm text-[var(--bg)] disabled:opacity-50"
            >
              {saving ? <Spinner /> : <IconCheck size={14} />}
              {saving ? 'Saving' : 'Save profile'}
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}

function UsageCard({ usage }: { usage: UsageSummary | null }) {
  if (!usage) {
    return (
      <Section title="Usage" description="Free-tier quota for the current month.">
        <EmptyState
          icon={<IconChartBar size={20} />}
          title="No usage yet"
          body="Run an ask or search to start the counter."
        />
      </Section>
    );
  }
  const pct = Math.min(100, (usage.used / Math.max(1, usage.limit)) * 100);
  const over = usage.used >= usage.limit;
  const near = usage.used / Math.max(1, usage.limit) >= 0.8;
  const bar = over ? 'bg-red-500' : near ? 'bg-amber-500' : 'bg-violet-500';
  return (
    <Section
      title="Usage"
      description={`${usage.used.toLocaleString()} of ${usage.limit.toLocaleString()} requests used, resets ${fmtResetDate(
        usage.resetsAt,
      )}.`}
    >
      <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-[var(--bg)]">
        <div
          className={`h-full ${bar} transition-all`}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-[var(--fg-muted)]">
        <span>
          Ask {usage.byKind.ask.toLocaleString()} / Search {usage.byKind.search.toLocaleString()}
        </span>
        <Link
          href="/usage"
          className="inline-flex items-center gap-1 text-[var(--fg)] hover:underline"
        >
          Full breakdown <IconArrowRight size={12} />
        </Link>
      </div>
      {over ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-[var(--fg)]">
          <IconWarning size={14} />
          <span>
            Free quota reached. Usage resets {fmtResetDate(usage.resetsAt)}. Upgrade is on the roadmap.
          </span>
        </div>
      ) : null}
    </Section>
  );
}

function AppearanceCard() {
  return (
    <Section title="Appearance" description="Theme preference stored locally in your browser.">
      <div className="flex items-center justify-between">
        <span className="text-sm text-[var(--fg-muted)]">Dark or light mode</span>
        <ThemeToggle />
      </div>
    </Section>
  );
}

function SystemCard({ health }: { health: HealthSummary | null }) {
  return (
    <Section title="System status" description="Health of the providers powering this instance.">
      <dl className="grid gap-2 text-sm">
        <Row label="Embed provider">
          <Status ok={!!health?.embed} />
        </Row>
        <Row label="LLM provider">
          <Status ok={!!health?.llm} />
        </Row>
        <Row label="Documents">
          <span className="cm-mono text-[12px]">{(health?.docs ?? 0).toLocaleString()}</span>
        </Row>
        <Row label="Chunks">
          <span className="cm-mono text-[12px]">{(health?.chunks ?? 0).toLocaleString()}</span>
        </Row>
      </dl>
    </Section>
  );
}

function ShortcutsCard() {
  const links: Array<{ href: string; label: string; description: string; Icon: typeof IconKey }> = [
    { href: '/keys', label: 'API keys', description: 'Issue, scope, and rotate keys.', Icon: IconKey },
    { href: '/webhooks', label: 'Webhooks', description: 'Outbound events on ask and ingest.', Icon: IconWebhook },
    { href: '/settings/sso', label: 'Single sign-on', description: 'OIDC against Google, Okta, Azure AD, Auth0, Keycloak.', Icon: IconShield },
    { href: '/settings/mfa', label: 'Multi-factor auth', description: 'TOTP step-up for keys, deletion, IP allowlist, and maintenance.', Icon: IconShield },
    { href: '/settings/security', label: 'IP allowlist', description: 'Restrict your account to trusted networks.', Icon: IconShield },
    { href: '/settings/sessions', label: 'Active sessions', description: 'See where you are signed in and force-logout any browser.', Icon: IconKey },
    { href: '/settings/notifications', label: 'Notification preferences', description: 'Pick which inbox alerts you want to receive.', Icon: IconSettings },
    { href: '/usage', label: 'Usage details', description: 'Per-kind breakdown and reset timer.', Icon: IconChartBar },
  ];
  return (
    <Section title="Account controls" description="Manage how this account talks to the outside world.">
      <ul className="grid gap-1">
        {links.map(({ href, label, description, Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-[var(--bg)]"
            >
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--fg-muted)]">
                <Icon size={14} />
              </span>
              <span className="flex-1">
                <span className="block text-[var(--fg)]">{label}</span>
                <span className="block text-xs text-[var(--fg-muted)]">{description}</span>
              </span>
              <IconArrowRight size={14} className="text-[var(--fg-muted)]" />
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function DataCard({ onChanged }: { onChanged: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [done, setDone] = useState<null | { removed: Record<string, number> }>(null);
  const [err, setErr] = useState<string | null>(null);

  const total = done
    ? Object.values(done.removed).reduce((a, b) => a + (b ?? 0), 0)
    : 0;

  const onDelete = async () => {
    if (confirm !== 'DELETE') return;
    setDeleting(true);
    setErr(null);
    try {
      const res = await api.meDeleteData();
      setDone({ removed: res.removed });
      setConfirm('');
      onChanged();
    } catch (e) {
      if (e instanceof ApiError) {
        setErr(`Delete failed (${e.status})`);
      } else {
        setErr(e instanceof Error ? e.message : 'delete failed');
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Section
      title="Your data"
      description="Export everything tied to this account, or erase it. Both actions are written to the server audit log."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <a
          href={`${API_BASE}/v1/me/export`}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--fg)] hover:bg-[var(--bg)]"
          download
        >
          <IconDownload size={14} />
          Export my data (JSON)
        </a>
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--fg)]">
            <IconTrash size={14} className="text-red-500" />
            Delete my data
          </div>
          <p className="mb-2 text-xs text-[var(--fg-muted)]">
            Removes history, conversations, saved items, feedback votes, and API keys for this
            account. Type DELETE to confirm.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="DELETE"
              aria-label="Type DELETE to confirm"
              className="cm-mono w-32 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[12px] outline-none focus:border-red-500"
            />
            <button
              type="button"
              onClick={onDelete}
              disabled={confirm !== 'DELETE' || deleting}
              className="inline-flex items-center gap-1.5 rounded-md bg-red-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting ? <Spinner /> : <IconTrash size={12} />}
              Erase
            </button>
          </div>
          {err ? (
            <div className="mt-2 text-xs text-red-500" role="alert">
              {err}
            </div>
          ) : null}
          {done ? (
            <div className="mt-2 text-xs text-[var(--fg)]" role="status">
              Removed {total} records: {Object.entries(done.removed)
                .filter(([, v]) => v)
                .map(([k, v]) => `${v} ${k}`)
                .join(', ') || 'nothing to remove'}.
            </div>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[var(--fg-muted)]">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Status({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12px] ${
        ok
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
          : 'border-red-500/40 bg-red-500/10 text-red-500'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
      {ok ? 'ok' : 'down'}
    </span>
  );
}
