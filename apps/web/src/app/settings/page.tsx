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
  SettingsCardSkeleton,
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
  IconBook,
  IconClockCountdown,
  IconNetwork,
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
    <div className="min-h-screen bg-cm-bg">
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:bg-cm-subtle disabled:opacity-50"
            aria-label="Refresh"
          >
            <IconRefresh size={14} />
            Refresh
          </button>
        </div>

        {loading && !usage ? (
          <div className="grid gap-6">
            <SettingsCardSkeleton rows={4} />
            <SettingsCardSkeleton rows={2} />
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
    <section className="rounded-xl border border-cm-border bg-cm-paper p-5">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-cm-fg">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs text-cm-muted">{description}</p>
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
              <code className="cm-mono text-[12px] text-cm-fg">{userId}</code>
            </Row>
            <Row label="Display name">
              <span className="text-cm-fg">{profile?.displayName ?? userId}</span>
            </Row>
            <Row label="Timezone">
              <span className="text-cm-fg">{profile?.timezone ?? 'UTC'}</span>
            </Row>
            <Row label="Default model">
              <span className="text-cm-fg">
                {profile?.defaultModel ?? (
                  <span className="text-cm-muted">server default</span>
                )}
              </span>
            </Row>
            <Row label="Plan">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2 py-0.5 text-[12px] capitalize text-cm-fg">
                {plan}
              </span>
            </Row>
          </dl>
          <div className="mt-4 flex items-center justify-between gap-3">
            {savedAt ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-cm-muted">
                <IconCheck size={12} /> Saved
              </span>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={begin}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cm-border px-3 py-1.5 text-sm text-cm-fg hover:bg-cm-subtle"
            >
              <IconPencil size={14} /> Edit profile
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} className="grid gap-3 text-sm">
          <label className="grid gap-1">
            <span className="text-xs text-cm-muted">Display name</span>
            <input
              type="text"
              required
              maxLength={80}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="rounded-lg border border-cm-border bg-cm-bg px-3 py-2 text-cm-fg outline-none focus:border-cm-border-strong"
              autoFocus
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-cm-muted">
              Timezone (IANA, e.g. America/Los_Angeles)
            </span>
            <div className="flex gap-2">
              <input
                type="text"
                required
                maxLength={64}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="flex-1 rounded-lg border border-cm-border bg-cm-bg px-3 py-2 text-cm-fg outline-none focus:border-cm-border-strong"
              />
              <button
                type="button"
                onClick={useLocalTz}
                className="rounded-lg border border-cm-border px-3 py-2 text-xs text-cm-muted hover:bg-cm-subtle"
              >
                Use local
              </button>
            </div>
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-cm-muted">
              Default model (leave empty for server default)
            </span>
            <input
              type="text"
              maxLength={80}
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              placeholder="gpt-4o-mini"
              className="rounded-lg border border-cm-border bg-cm-bg px-3 py-2 text-cm-fg outline-none focus:border-cm-border-strong"
            />
          </label>
          {err ? (
            <div className="flex items-start gap-2 rounded-lg border p-2 text-xs text-cm-fg"
              style={{ borderColor: 'var(--cm-danger)', background: 'rgba(180, 66, 60, 0.08)' }}>
              <IconWarning size={14} /> <span>{err}</span>
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="rounded-lg border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:bg-cm-subtle disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cm-border px-3 py-1.5 text-sm disabled:opacity-50"
              style={{ background: 'var(--cm-fg)', color: 'var(--cm-bg)' }}
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
  // Warm-palette quota tint, matching the /usage page: accent at rest,
  // citation gold as the "getting close" caution, danger red once capped.
  const barColor = over ? 'var(--cm-danger)' : near ? 'var(--cm-cite)' : 'var(--cm-accent)';
  return (
    <Section
      title="Usage"
      description={`${usage.used.toLocaleString()} of ${usage.limit.toLocaleString()} requests used, resets ${fmtResetDate(
        usage.resetsAt,
      )}.`}
    >
      <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-cm-subtle">
        <div
          className="h-full transition-all"
          style={{ width: `${pct}%`, background: barColor }}
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-cm-muted">
        <span>
          Ask {usage.byKind.ask.toLocaleString()} / Search {usage.byKind.search.toLocaleString()}
        </span>
        <Link
          href="/usage"
          className="inline-flex items-center gap-1 text-cm-fg hover:underline"
        >
          Full breakdown <IconArrowRight size={12} />
        </Link>
      </div>
      {over ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border p-3 text-xs text-cm-fg"
          style={{ borderColor: 'var(--cm-cite-line)', background: 'var(--cm-cite-bg)' }}>
          <span style={{ color: 'var(--cm-cite)' }}><IconWarning size={14} /></span>
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
        <span className="text-sm text-cm-muted">Dark or light mode</span>
        <ThemeToggle />
      </div>
      <div className="mt-4 border-t border-cm-border pt-4">
        <AccentSwatch />
      </div>
    </Section>
  );
}

// Live preview of the brand accent family, sampled from the running theme so
// it tracks dark/light. Surfaces the four tones (accent / ink / line / soft)
// the app paints with, applied to the same chip + dot + rail shapes used
// across the UI, with the resolved value shown. This is the ready-made
// surface for a future "pick your accent" control: today it just mirrors the
// theme accent, so a reader can see exactly what the brand color does.
function AccentSwatch() {
  const [accent, setAccent] = useState<string>('');
  useEffect(() => {
    const read = () =>
      setAccent(
        getComputedStyle(document.documentElement).getPropertyValue('--cm-accent').trim(),
      );
    read();
    // Re-sample when the theme toggles (class/data-theme flip on <html>).
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => obs.disconnect();
  }, []);
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <span className="text-sm text-cm-muted">Accent color</span>
        <p className="cm-mono mt-0.5 text-[11px] uppercase tracking-wider text-cm-faint">
          {accent || 'theme accent'}
        </p>
      </div>
      <div className="flex items-center gap-1.5" aria-label="Accent preview">
        <span className="h-5 w-5 rounded-full" style={{ background: 'var(--cm-accent)' }} title="accent" />
        <span className="h-5 w-5 rounded-full" style={{ background: 'var(--cm-accent-ink)' }} title="ink" />
        <span className="h-5 w-5 rounded-full" style={{ background: 'var(--cm-accent-soft)', boxShadow: 'inset 0 0 0 1px var(--cm-accent-line)' }} title="soft" />
        <span className="inline-flex items-center rounded-md bg-cm-accent-soft px-2 py-1 text-[11px] text-cm-accent-ink" style={{ boxShadow: 'inset 2px 0 0 var(--cm-accent-line)' }}>Sample</span>
      </div>
    </div>
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
    { href: '/settings/whoami', label: 'Identity (whoami)', description: 'Token and session debugger. Shows the user, API key id, scopes, source IP, and request id the server sees for this call. Safe to share with support.', Icon: IconShield },
    { href: '/webhooks', label: 'Webhooks', description: 'Outbound events on ask and ingest.', Icon: IconWebhook },
    { href: '/settings/sso', label: 'Single sign-on', description: 'OIDC against Google, Okta, Azure AD, Auth0, Keycloak.', Icon: IconShield },
    { href: '/settings/mfa', label: 'Multi-factor auth', description: 'TOTP step-up for keys, deletion, IP allowlist, and maintenance.', Icon: IconShield },
    { href: '/settings/security', label: 'IP allowlist', description: 'Restrict your account to trusted networks.', Icon: IconShield },
    { href: '/settings/webhook-allowlist', label: 'Webhook allowlist', description: 'Restrict outbound webhook deliveries to approved hostnames.', Icon: IconWebhook },
    { href: '/settings/webhook-events-allowlist', label: 'Webhook event allowlist', description: 'Restrict which webhook event subjects can be subscribed to at all.', Icon: IconWebhook },
    { href: '/settings/sessions', label: 'Active sessions', description: 'See where you are signed in and force-logout any browser.', Icon: IconKey },
    { href: '/settings/sign-in-log', label: 'Sign-in activity', description: 'Audit every login attempt, including failures and probes. Admins see the full workspace feed.', Icon: IconShield },
    { href: '/settings/sign-in-anomalies', label: 'Sign-in anomalies', description: 'Impossible-travel detection. Flags successful sign-ins from two countries that imply faster-than-flight travel.', Icon: IconWarning },
    { href: '/settings/sign-in-geofence', label: 'Sign-in geofence', description: 'Restrict which ISO 3166 countries may complete a sign-in. Allow or block list with fail-closed default.', Icon: IconNetwork },
    { href: '/settings/members', label: 'Members and RBAC', description: 'Invite teammates and assign owner, admin, member, or viewer.', Icon: IconShield },
    { href: '/settings/access-reviews', label: 'Access reviews', description: 'Periodic recertification of who has access. Required for SOC2 CC6.3 and ISO 27001 A.9.2.5.', Icon: IconShield },
    { href: '/settings/role-elevation', label: 'Role elevation', description: 'Break-glass time-bound privilege grants with four-eyes approval and full audit. Required for SOC2 CC6.3 privileged access.', Icon: IconClockCountdown },
    { href: '/settings/offboarding', label: 'Offboarding cleanup', description: 'Revoke API keys and sessions left behind by removed members. Sweeps run automatically on every removal.', Icon: IconShield },
    { href: '/settings/invitations', label: 'Email invitations', description: 'Send one-time invitation links that pre-bind a role and expire.', Icon: IconShield },
    { href: '/settings/domains', label: 'Domain auto-join', description: 'Auto-enrol new sign-ins from verified email domains.', Icon: IconShield },
    { href: '/settings/scim', label: 'SCIM provisioning', description: 'Let Okta, Azure AD, or Google Workspace push users via SCIM 2.0.', Icon: IconShield },
    { href: '/settings/retention', label: 'Data retention', description: 'Auto-erase history and conversations on a schedule.', Icon: IconClockCountdown },
    { href: '/settings/legal-hold', label: 'Legal hold', description: 'Suppress deletion across the workspace during litigation or investigation.', Icon: IconShield },
    { href: '/settings/workspace-freeze', label: 'Workspace freeze', description: 'Pause every mutating endpoint while keeping reads and exports available.', Icon: IconShield },
    { href: '/settings/vendor-access', label: 'Vendor support access', description: 'Default-closed lockbox controlling whether vendor support can read this workspace. Time-bound, audited grants.', Icon: IconShield },
    { href: '/settings/workspace-deletion', label: 'Workspace deletion', description: 'Schedule a tenant-wide wipe with a cancelable grace window. Owner only.', Icon: IconTrash },
    { href: '/settings/mfa-policy', label: 'MFA enforcement', description: 'Require every member to enrol multi-factor auth before any write is accepted.', Icon: IconShield },
    { href: '/settings/session-policy', label: 'Session lifetime', description: 'Cap how long a signed-in browser session lives and how long it can sit idle.', Icon: IconClockCountdown },
    { href: '/settings/share-policy', label: 'Public share policy', description: 'Disable public share links, require an explicit expiry, or cap the maximum link TTL across the workspace.', Icon: IconShield },
    { href: '/settings/login-banner', label: 'Login banner', description: 'Pre-auth system use notification with per-session acknowledgment. Required for NIST 800-53 AC-8 and FedRAMP.', Icon: IconShield },
    { href: '/settings/api-key-policy', label: 'API key policy', description: 'Cap key lifetime, require expiry, limit active keys per user, forbid wildcard scopes, and flag overdue rotations.', Icon: IconKey },
    { href: '/settings/api-key-inactivity', label: 'API key inactivity sweep', description: 'Auto revoke API keys that have not been used in an owner configured window. SOC2 CC6.1 control with audit log and dry run preview.', Icon: IconClockCountdown },
    { href: '/settings/api-key-expiry', label: 'API key expiry warnings', description: 'Advertise upcoming TTL based key expiry to every authenticated request via Warning headers, and list keys about to lapse so customers rotate before integrations break.', Icon: IconClockCountdown },
    { href: '/settings/key-activation', label: 'Key activation schedule', description: 'Pre-mint API keys with a fixed activation timestamp. The key refuses to authenticate until the scheduled moment, then goes live without a manual rotation step.', Icon: IconClockCountdown },
    { href: '/settings/encryption', label: 'Encryption keys (CMEK)', description: 'Bring your own KEK, rotate the workspace DEK, and audit every key transition. Owner only with MFA step up.', Icon: IconKey },
    { href: '/settings/workspace-export', label: 'Workspace export (GDPR)', description: 'Owner-only tenant-wide data export as JSON or ZIP. Required for exit and data-portability obligations.', Icon: IconShield },
    { href: '/settings/query-blocklist', label: 'Query blocklist', description: 'Block literal or regex patterns from reaching retrieval or the model on ask, search, and explain.', Icon: IconShield },
    { href: '/settings/model-allowlist', label: 'Model allowlist', description: 'Restrict which LLM model identifiers may serve answers. Enforced on ask and ask stream with audit log; supports allow and block modes.', Icon: IconShield },
    { href: '/settings/pii-redaction', label: 'PII redaction', description: 'Scrub or block email, phone, SSN, credit card, IP, and custom regex matches before any query reaches retrieval or the LLM.', Icon: IconShield },
    { href: '/settings/pii-redaction', label: 'PII redaction', description: 'Redact or block secrets such as emails, SSNs and credit cards before any query reaches the LLM.', Icon: IconShield },
    { href: '/settings/policies', label: 'Workspace policies', description: 'Publish TOS, DPA, and AUP versions and track per-user acceptance.', Icon: IconBook },
    { href: '/settings/acceptable-use', label: 'Acceptable use enforcement', description: 'Publish a versioned acceptable use policy and block writes from members who have not accepted the current version. Owner only with MFA step up.', Icon: IconBook },
    { href: '/settings/maintenance', label: 'Storage maintenance', description: 'Compact dangling rows and bulk forget indexed sources by glob.', Icon: IconShield },
    { href: '/settings/notifications', label: 'Notification preferences', description: 'Pick which inbox alerts you want to receive.', Icon: IconSettings },
    { href: '/usage', label: 'Usage details', description: 'Per-kind breakdown and reset timer.', Icon: IconChartBar },
    { href: '/settings/quota', label: 'Workspace quota', description: 'Cap monthly ask/search/batch spend across the workspace and per member. Required for enterprise spend controls.', Icon: IconChartBar },
    { href: '/settings/api-key-bruteforce', label: 'API key brute-force monitor', description: 'See source IPs blocked after repeated failed Bearer verifications and clear individual lockouts.', Icon: IconShield },
    { href: '/settings/sub-processors', label: 'Sub-processors', description: 'GDPR Article 28 disclosure registry referenced by your DPA. Mutations are audit logged and notify members.', Icon: IconShield },
    { href: '/settings/dpa', label: 'Data Processing Agreement', description: 'Record owner acceptance of a versioned DPA. Returns an HMAC-signed receipt for the buyer\u2019s legal team.', Icon: IconShield },
    { href: '/settings/ropa', label: 'Record of Processing Activities', description: 'GDPR Article 30 register of processing activities. Public projection at /v1/ropa lets a buyer DPO cite a stable URL during their own register review.', Icon: IconShield },
    { href: '/settings/recovery-contacts', label: 'Recovery contacts', description: 'Named escalation channels for BCP / incident response. Public projection at /v1/recovery-contacts for buyer runbooks.', Icon: IconShield },
    { href: '/settings/honeytokens', label: 'Honeytokens', description: 'Mint canary API keys, plant them as bait, and get a forensic incident the first time an attacker uses one. Owner only.', Icon: IconShield },
    { href: '/settings/trust', label: 'Trust Center', description: 'Edit the public security and compliance page that procurement reviewers cite by URL. Owner only, MFA gated.', Icon: IconShield },
    { href: '/settings/warrant-canary', label: 'Warrant canary', description: 'Recurring public attestation that no undisclosed legal process has been received. Public projection at /v1/warrant-canary that buyers pin in their vendor file. Owner only, MFA gated.', Icon: IconShield },
    { href: '/settings/erasure-certificates', label: 'Erasure certificates', description: 'GDPR Article 17 destruction receipts. One signed certificate per fulfilled erasure request, verifiable offline by the subject and their auditor.', Icon: IconShield },
    { href: '/settings/audit-proofs', label: 'Audit inclusion proofs', description: 'Mint an HMAC signed certificate that pins a single audit event to its position in the chain. Hand to an auditor for offline proof the event was logged and unaltered.', Icon: IconKey },
    { href: '/settings/data-residency', label: 'Data residency', description: 'Restrict mutating writes to a chosen set of regions. Reads are unaffected. Returned on every response as x-clawmind-region.', Icon: IconShield },
  ];
  return (
    <Section title="Account controls" description="Manage how this account talks to the outside world.">
      <ul className="grid gap-1">
        {links.map(({ href, label, description, Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-cm-subtle"
            >
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-cm-border text-cm-muted">
                <Icon size={14} />
              </span>
              <span className="flex-1">
                <span className="block text-cm-fg">{label}</span>
                <span className="block text-xs text-cm-muted">{description}</span>
              </span>
              <IconArrowRight size={14} className="text-cm-muted" />
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
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<null | {
    previewedAt: number;
    wouldRemove: {
      historyItems: number;
      conversations: number;
      savedItems: number;
      feedbackVotes: number;
      apiKeys: number;
    };
  }>(null);
  const [done, setDone] = useState<null | { removed: Record<string, number> }>(null);
  const [err, setErr] = useState<string | null>(null);

  const total = done
    ? Object.values(done.removed).reduce((a, b) => a + (b ?? 0), 0)
    : 0;
  const previewTotal = preview
    ? Object.values(preview.wouldRemove).reduce((a, b) => a + (b ?? 0), 0)
    : 0;

  const onPreview = async () => {
    setPreviewing(true);
    setErr(null);
    try {
      const res = await api.meDeleteDataPreview();
      setPreview({ previewedAt: res.previewedAt, wouldRemove: res.wouldRemove });
      setDone(null);
    } catch (e) {
      if (e instanceof ApiError) setErr(`Preview failed (${e.status})`);
      else setErr(e instanceof Error ? e.message : 'preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const onDelete = async () => {
    if (confirm !== 'DELETE') return;
    setDeleting(true);
    setErr(null);
    try {
      const res = await api.meDeleteData();
      setDone({ removed: res.removed });
      setConfirm('');
      setPreview(null);
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
        <div className="flex flex-col gap-2">
          <a
            href={`${API_BASE}/v1/me/export`}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-cm-border px-3 py-2 text-sm text-cm-fg hover:bg-cm-subtle"
            download
          >
            <IconDownload size={14} />
            Export my data (JSON)
          </a>
          <a
            href={`${API_BASE}/v1/me/export.zip`}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-cm-border px-3 py-2 text-sm text-cm-fg hover:bg-cm-subtle"
            download
          >
            <IconDownload size={14} />
            Export my data (ZIP, JSON + CSV)
          </a>
          <p className="text-[11px] text-cm-muted">
            ZIP archive ships the structured JSON alongside per-table CSVs and a manifest, suitable for BI imports and legal hold.
          </p>
        </div>
        <div className="rounded-lg border p-3" style={{ borderColor: 'var(--cm-danger)', background: 'rgba(180, 66, 60, 0.06)' }}>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-cm-fg">
            <IconTrash size={14} className="text-cm-danger" />
            Delete my data
          </div>
          <p className="mb-2 text-xs text-cm-muted">
            Removes history, conversations, saved items, feedback votes, and API keys for this
            account. Type DELETE to confirm. Use Preview first to see counts before erasing.
          </p>
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={onPreview}
              disabled={previewing || deleting}
              className="inline-flex items-center gap-1.5 rounded-md border border-cm-border bg-cm-bg px-2.5 py-1 text-[11px] font-medium text-cm-fg hover:bg-cm-subtle disabled:cursor-not-allowed disabled:opacity-50"
            >
              {previewing ? <Spinner /> : <IconWarning size={12} />}
              Preview deletion
            </button>
            {preview ? (
              <span className="text-[11px] text-cm-muted">
                {previewTotal} record{previewTotal === 1 ? '' : 's'} would be erased
              </span>
            ) : null}
          </div>
          {preview ? (
            <ul className="mb-2 grid grid-cols-2 gap-x-3 gap-y-0.5 rounded-md border border-cm-border bg-cm-bg p-2 text-[11px] text-cm-muted" role="status">
              <li>History items: <span className="cm-mono text-cm-fg">{preview.wouldRemove.historyItems}</span></li>
              <li>Conversations: <span className="cm-mono text-cm-fg">{preview.wouldRemove.conversations}</span></li>
              <li>Saved items: <span className="cm-mono text-cm-fg">{preview.wouldRemove.savedItems}</span></li>
              <li>Feedback votes: <span className="cm-mono text-cm-fg">{preview.wouldRemove.feedbackVotes}</span></li>
              <li>API keys: <span className="cm-mono text-cm-fg">{preview.wouldRemove.apiKeys}</span></li>
            </ul>
          ) : null}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="DELETE"
              aria-label="Type DELETE to confirm"
              className="cm-mono w-32 rounded-md border border-cm-border bg-cm-bg px-2 py-1.5 text-[12px] outline-none"
              style={{ caretColor: 'var(--cm-danger)' }}
            />
            <button
              type="button"
              onClick={onDelete}
              disabled={confirm !== 'DELETE' || deleting}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: 'var(--cm-danger)' }}
            >
              {deleting ? <Spinner /> : <IconTrash size={12} />}
              Erase
            </button>
          </div>
          {err ? (
            <div className="mt-2 text-xs text-cm-danger" role="alert">
              {err}
            </div>
          ) : null}
          {done ? (
            <div className="mt-2 text-xs text-cm-fg" role="status">
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
      <dt className="text-cm-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Status({ ok }: { ok: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12px]"
      style={{
        borderColor: ok ? 'var(--cm-success)' : 'var(--cm-danger)',
        color: ok ? 'var(--cm-success)' : 'var(--cm-danger)',
        background: ok ? 'rgba(47, 122, 85, 0.10)' : 'rgba(180, 66, 60, 0.10)',
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: ok ? 'var(--cm-success)' : 'var(--cm-danger)' }}
      />
      {ok ? 'ok' : 'down'}
    </span>
  );
}
