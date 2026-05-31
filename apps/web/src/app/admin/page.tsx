'use client';
// Unified admin console. One screen that surfaces tenant security posture
// so an enterprise security reviewer can demo "yes MFA is on, yes SSO is
// wired, yes the audit chain verifies, here is the active session count"
// without clicking through eight separate settings pages.
//
// All numbers come from GET /v1/admin/overview which is owner-gated and
// admin:read scoped on the server. The fetch itself is recorded in the
// audit log, so the act of reviewing posture leaves its own trace.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { TopNav } from '@/components/TopNav';
import { api, ApiError, fmtRelative, type AdminOverview } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconShield,
  IconKey,
  IconWebhook,
  IconNetwork,
  IconClockCountdown,
  IconWarning,
  IconCheck,
  IconRefresh,
  IconArrowRight,
} from '@clawmind/ui';

type Tone = 'ok' | 'warn' | 'off' | 'neutral';

interface StatProps {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
}

function Stat({ label, value, hint, tone = 'neutral' }: StatProps) {
  const toneClass =
    tone === 'ok'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'off'
          ? 'text-[var(--muted)]'
          : 'text-[var(--fg)]';
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className={`mt-0.5 text-base font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {hint ? <div className="mt-0.5 truncate text-xs text-[var(--muted)]">{hint}</div> : null}
    </div>
  );
}

interface SectionProps {
  title: string;
  href?: string;
  hrefLabel?: string;
  icon: React.ReactNode;
  status: { tone: Tone; label: string };
  children: React.ReactNode;
}

function Section({ title, href, hrefLabel, icon, status, children }: SectionProps) {
  const dot =
    status.tone === 'ok'
      ? 'bg-emerald-500'
      : status.tone === 'warn'
        ? 'bg-amber-500'
        : status.tone === 'off'
          ? 'bg-[var(--muted)]'
          : 'bg-[var(--fg)]';
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[var(--fg)]" aria-hidden>{icon}</span>
          <h2 className="text-sm font-semibold tracking-tight sm:text-base">{title}</h2>
          <span className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
            <span>{status.label}</span>
          </span>
        </div>
        {href ? (
          <Link
            href={href as never}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            {hrefLabel ?? 'Manage'}
            <IconArrowRight size={12} />
          </Link>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-32 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]"
          aria-hidden
        />
      ))}
    </div>
  );
}

function shortHash(h: string | null): string {
  if (!h) return 'not yet anchored';
  return h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}

function formatDays(n: number | null): string {
  if (n === null) return 'keep forever';
  return `${n} day${n === 1 ? '' : 's'}`;
}

export default function AdminPage() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const o = await api.adminOverview();
      setOverview(o);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setForbidden(true);
      } else {
        setError(err instanceof Error ? err.message : 'failed to load admin overview');
      }
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
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconShield size={22} />
            <div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Admin console</h1>
              <p className="text-sm text-[var(--muted)]">
                Tenant security posture at a glance. Owner only.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            <IconRefresh size={14} />
            <span>Refresh</span>
          </button>
        </div>

        {forbidden ? (
          <EmptyState
            icon={<IconShield size={28} />}
            title="Owner role required"
            body="The admin console only loads for the workspace owner with an admin:read capable session. Sign in as the owner or use a key that includes admin:read."
          />
        ) : error ? (
          <ErrorState title="Could not load admin overview" message={error} onRetry={() => void load()} />
        ) : loading || !overview ? (
          <Skeleton />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Section
              title="Identity and access"
              icon={<IconShield size={16} />}
              href="/settings/sso"
              status={
                overview.sso.configured
                  ? { tone: 'ok', label: 'SSO live' }
                  : { tone: 'off', label: 'SSO off' }
              }
            >
              <div className="grid grid-cols-2 gap-2">
                <Stat
                  label="SSO"
                  value={overview.sso.configured ? 'Configured' : 'Not configured'}
                  tone={overview.sso.configured ? 'ok' : 'off'}
                  hint={overview.sso.issuer ?? undefined}
                />
                <Stat
                  label="MFA"
                  value={
                    overview.mfa.confirmed
                      ? 'Enrolled'
                      : overview.mfa.enrolled
                        ? 'Pending'
                        : 'Off'
                  }
                  tone={overview.mfa.confirmed ? 'ok' : overview.mfa.enrolled ? 'warn' : 'off'}
                  hint={`${overview.mfa.recoveryCodes} recovery codes`}
                />
                <Stat
                  label="Allowed domains"
                  value={String(overview.sso.allowedDomains.length)}
                  hint={overview.sso.allowedDomains.slice(0, 3).join(', ') || 'any verified domain'}
                />
                <Stat label="Caller role" value={overview.user.role} hint={overview.user.id} />
              </div>
            </Section>

            <Section
              title="Sessions"
              icon={<IconClockCountdown size={16} />}
              href="/settings/sessions"
              hrefLabel="Manage"
              status={{
                tone: overview.sessions.active > 10 ? 'warn' : 'ok',
                label: `${overview.sessions.active} active`,
              }}
            >
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Active sessions" value={String(overview.sessions.active)} />
                <Stat
                  label="Last seen"
                  value={overview.sessions.lastSeenAt ? fmtRelative(overview.sessions.lastSeenAt) : '—'}
                />
              </div>
            </Section>

            <Section
              title="API keys"
              icon={<IconKey size={16} />}
              href="/keys"
              status={
                overview.apiKeys.active === 0
                  ? { tone: 'off', label: 'none issued' }
                  : { tone: 'ok', label: `${overview.apiKeys.active} active` }
              }
            >
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Active" value={String(overview.apiKeys.active)} tone="ok" />
                <Stat
                  label="Revoked"
                  value={String(overview.apiKeys.revoked)}
                  tone={overview.apiKeys.revoked > 0 ? 'warn' : 'neutral'}
                />
                <Stat label="Total ever" value={String(overview.apiKeys.total)} />
                <Stat
                  label="Last used"
                  value={overview.apiKeys.lastUsedAt ? fmtRelative(overview.apiKeys.lastUsedAt) : 'never'}
                />
              </div>
            </Section>

            <Section
              title="Webhooks (24h)"
              icon={<IconWebhook size={16} />}
              href="/webhooks"
              status={
                overview.webhooks.failuresRecent > 0
                  ? { tone: 'warn', label: `${overview.webhooks.failuresRecent} failing` }
                  : overview.webhooks.configured === 0
                    ? { tone: 'off', label: 'none configured' }
                    : { tone: 'ok', label: 'healthy' }
              }
            >
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Endpoints" value={String(overview.webhooks.configured)} />
                <Stat label="Deliveries" value={String(overview.webhooks.deliveriesRecent)} />
                <Stat
                  label="Failures"
                  value={String(overview.webhooks.failuresRecent)}
                  tone={overview.webhooks.failuresRecent > 0 ? 'warn' : 'ok'}
                />
                <Stat
                  label="Last delivery"
                  value={overview.webhooks.lastDeliveryAt ? fmtRelative(overview.webhooks.lastDeliveryAt) : '—'}
                />
              </div>
            </Section>

            <Section
              title="Network controls"
              icon={<IconNetwork size={16} />}
              href="/settings/security"
              hrefLabel="Configure"
              status={
                overview.ipAllowlist.enabled
                  ? { tone: 'ok', label: 'allowlist on' }
                  : { tone: 'off', label: 'open to all IPs' }
              }
            >
              <div className="grid grid-cols-2 gap-2">
                <Stat
                  label="IP allowlist"
                  value={overview.ipAllowlist.enabled ? 'Enabled' : 'Disabled'}
                  tone={overview.ipAllowlist.enabled ? 'ok' : 'off'}
                />
                <Stat label="Rules" value={String(overview.ipAllowlist.rules)} />
              </div>
            </Section>

            <Section
              title="Data lifecycle"
              icon={<IconClockCountdown size={16} />}
              href="/settings/retention"
              status={{
                tone:
                  overview.retention.historyDays || overview.retention.conversationDays || overview.retention.auditDays
                    ? 'ok'
                    : 'off',
                label: overview.retention.lastSweepAt ? `swept ${fmtRelative(overview.retention.lastSweepAt)}` : 'never swept',
              }}
            >
              <div className="grid grid-cols-2 gap-2">
                <Stat label="History" value={formatDays(overview.retention.historyDays)} />
                <Stat label="Conversations" value={formatDays(overview.retention.conversationDays)} />
                <Stat label="Audit log" value={formatDays(overview.retention.auditDays)} />
                <Stat
                  label="Last sweep"
                  value={overview.retention.lastSweepAt ? fmtRelative(overview.retention.lastSweepAt) : 'never'}
                />
              </div>
            </Section>

            <Section
              title="Audit chain"
              icon={overview.audit.verified ? <IconCheck size={16} /> : <IconWarning size={16} />}
              href="/audit"
              hrefLabel="Review"
              status={
                overview.audit.verified
                  ? { tone: 'ok', label: 'chain verified' }
                  : { tone: 'warn', label: 'chain broken' }
              }
            >
              <div className="grid grid-cols-2 gap-2">
                <Stat
                  label="Head hash"
                  value={shortHash(overview.audit.headHash)}
                  tone={overview.audit.verified ? 'ok' : 'warn'}
                />
                <Stat label="Events (24h)" value={String(overview.audit.recentEvents)} />
              </div>
              <p className="mt-3 text-xs text-[var(--muted)]">
                Anchor the head hash externally (commit it to a ticket or notary). A later verify that returns a
                different head proves on disk tampering.
              </p>
            </Section>
          </div>
        )}
      </main>
    </div>
  );
}
