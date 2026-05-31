'use client';

// /settings/sso surfaces the OIDC SSO configuration for procurement reviewers
// and IT admins. It does not edit secrets in the browser; instead it shows
// what the server has wired up (issuer, client id, redirect uri, allowed
// domains, enforcement mode) so an admin can verify the deployment matches
// what their IdP expects. Secrets stay on the server in env vars.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, API_BASE, ApiError } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconShield,
  IconKey,
  IconCheck,
  IconWarning,
  IconArrowRight,
  IconRefresh,
} from '@clawmind/ui';

interface SsoConfig {
  enabled: boolean;
  enforced: boolean;
  issuer: string | null;
  clientId: string | null;
  redirectUri: string | null;
  allowedDomains: string[];
  scopes: string | null;
  mode: 'single-user' | 'github' | 'oidc';
}

export default function SsoSettingsPage() {
  const [config, setConfig] = useState<SsoConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const c = await api.ssoConfig();
      setConfig(c);
    } catch (err) {
      const msg = err instanceof ApiError ? `Failed to load (${err.status})` : err instanceof Error ? err.message : 'failed to load';
      setError(msg);
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
            <IconShield size={22} />
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Single sign-on</h1>
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            <IconRefresh size={12} />
            Refresh
          </button>
        </div>

        <p className="mb-6 max-w-2xl text-sm text-[var(--fg-muted)]">
          ClawMind supports OIDC single sign-on against any spec-compliant provider:
          Google Workspace, Okta, Azure AD or Entra ID, Auth0, Keycloak. Configuration
          lives in server environment variables so credentials never leave the host.
        </p>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-[var(--fg-muted)]">
            <Spinner /> Loading SSO status
          </div>
        )}

        {!loading && error && <ErrorState message={error} onRetry={load} />}

        {!loading && !error && config && (
          <div className="grid gap-4">
            <StatusCard config={config} />
            <DetailCard config={config} />
            {config.enabled && <SignInCard />}
            {!config.enabled && <NotConfiguredCard />}
            <PolicyCard config={config} />
            <BackLink />
          </div>
        )}
      </main>
    </div>
  );
}

function StatusCard({ config }: { config: SsoConfig }) {
  const enabled = config.enabled;
  const enforced = config.enforced;
  const status = !enabled
    ? { label: 'Not configured', tone: 'muted' as const, Icon: IconWarning }
    : enforced
      ? { label: 'Enforced for this deployment', tone: 'positive' as const, Icon: IconCheck }
      : { label: 'Available, not enforced', tone: 'neutral' as const, Icon: IconShield };
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Status</h2>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">
            Auth mode controls which login methods the API accepts. Set
            <span className="cm-mono mx-1 rounded bg-[var(--bg)] px-1 py-0.5 text-[11px]">CLAWMIND_AUTH_MODE=oidc</span>
            to require SSO for every browser session.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-1 text-xs ${
            status.tone === 'positive'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
              : status.tone === 'neutral'
                ? 'border-sky-500/30 bg-sky-500/10 text-sky-600'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-600'
          }`}
        >
          <status.Icon size={12} />
          {status.label}
        </span>
      </div>
      <dl className="mt-4 grid gap-2 text-xs">
        <Row label="Auth mode">
          <span className="cm-mono">{config.mode}</span>
        </Row>
        <Row label="SSO enforced">
          <span>{enforced ? 'Yes' : 'No'}</span>
        </Row>
      </dl>
    </section>
  );
}

function DetailCard({ config }: { config: SsoConfig }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-4 sm:p-5">
      <h2 className="text-sm font-semibold">Identity provider</h2>
      <p className="mt-1 text-xs text-[var(--fg-muted)]">
        These values come from the server environment. Share the redirect URI with
        your IdP admin so they can register ClawMind as a client.
      </p>
      <dl className="mt-4 grid gap-2 text-xs">
        <Row label="Issuer">
          <Mono>{config.issuer || 'not set'}</Mono>
        </Row>
        <Row label="Client ID">
          <Mono>{config.clientId || 'not set'}</Mono>
        </Row>
        <Row label="Redirect URI">
          <Mono>{config.redirectUri || 'not set'}</Mono>
        </Row>
        <Row label="Scopes">
          <Mono>{config.scopes || 'openid email profile'}</Mono>
        </Row>
      </dl>
    </section>
  );
}

function PolicyCard({ config }: { config: SsoConfig }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-4 sm:p-5">
      <h2 className="text-sm font-semibold">Workspace policy</h2>
      <p className="mt-1 text-xs text-[var(--fg-muted)]">
        Only verified emails whose domain appears in the allowlist may sign in.
        An empty allowlist accepts any account the IdP returns.
      </p>
      <div className="mt-4">
        {config.allowedDomains.length === 0 ? (
          <EmptyState
            title="No domain allowlist"
            body="Anyone with a valid account at the configured IdP can sign in. Set CLAWMIND_OIDC_ALLOWED_DOMAINS to restrict by email domain."
          />
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {config.allowedDomains.map((d) => (
              <li
                key={d}
                className="cm-mono inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[11px]"
              >
                <IconCheck size={10} />
                {d}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function SignInCard() {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-4 sm:p-5">
      <h2 className="text-sm font-semibold">Sign in with SSO</h2>
      <p className="mt-1 text-xs text-[var(--fg-muted)]">
        Use this link to test the full round trip against your IdP.
      </p>
      <a
        href={`${API_BASE}/auth/oidc`}
        className="mt-3 inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] hover:bg-[var(--bg-hover)]"
      >
        <IconKey size={14} />
        Continue with SSO
        <IconArrowRight size={12} />
      </a>
    </section>
  );
}

function NotConfiguredCard() {
  return (
    <section className="rounded-xl border border-dashed border-[var(--border)] p-4 sm:p-5">
      <h2 className="text-sm font-semibold">Configure your IdP</h2>
      <p className="mt-2 text-xs text-[var(--fg-muted)]">
        Set the following on the API host and restart. The discovery document
        at <Mono>{'{issuer}/.well-known/openid-configuration'}</Mono> is fetched
        on demand.
      </p>
      <pre className="cm-mono mt-3 overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--bg)] p-3 text-[11px] leading-relaxed text-[var(--fg)]">
{`CLAWMIND_AUTH_MODE=oidc
CLAWMIND_OIDC_ISSUER=https://accounts.google.com
CLAWMIND_OIDC_CLIENT_ID=...apps.googleusercontent.com
CLAWMIND_OIDC_CLIENT_SECRET=...
CLAWMIND_OIDC_REDIRECT_URI=https://your-host/auth/oidc/callback
CLAWMIND_OIDC_ALLOWED_DOMAINS=acme.com`}
      </pre>
    </section>
  );
}

function BackLink() {
  return (
    <Link
      href="/settings"
      className="inline-flex items-center gap-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]"
    >
      <IconArrowRight size={12} className="rotate-180" />
      Back to settings
    </Link>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--border)] pb-2 last:border-0 last:pb-0">
      <dt className="text-[var(--fg-muted)]">{label}</dt>
      <dd className="min-w-0 flex-1 break-all text-right text-[var(--fg)]">{children}</dd>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="cm-mono text-[11px]">{children}</span>;
}
