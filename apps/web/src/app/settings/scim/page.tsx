'use client';

// /settings/scim is where the workspace owner mints, rotates, and revokes
// the bearer token an enterprise IdP uses to push SCIM 2.0 user
// provisioning. Plaintext is shown exactly once on rotate, then only the
// metadata (id, createdAt, lastUsedAt) is recoverable. The page also
// surfaces the discovery URL so an Okta / Azure AD admin can paste it
// straight into their provisioning wizard.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, API_BASE, ApiError, type ScimTokenView } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  SettingsCardSkeleton,
  Spinner,
  IconShield,
  IconKey,
  IconCheck,
  IconCopy,
  IconWarning,
  IconArrowRight,
  IconRefresh,
  IconTrash,
} from '@clawmind/ui';

function fmtTs(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

export default function ScimSettingsPage() {
  const [view, setView] = useState<ScimTokenView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'rotate' | 'revoke' | null>(null);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setView(await api.scimTokenGet());
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.status === 403
            ? 'Only the workspace owner can manage the SCIM token.'
            : `Failed to load (${err.status})`
          : err instanceof Error
            ? err.message
            : 'failed to load';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rotate = async () => {
    setBusy('rotate');
    setError(null);
    try {
      const r = await api.scimTokenRotate();
      setPlaintext(r.token);
      await load();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.status === 401
            ? 'Multi-factor verification required. Visit Settings, then MFA, then retry.'
            : `Rotate failed (${err.status})`
          : err instanceof Error
            ? err.message
            : 'rotate failed';
      setError(msg);
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    if (!confirm('Revoke the SCIM token? IdP provisioning will stop until you mint a new one.')) return;
    setBusy('revoke');
    setError(null);
    try {
      await api.scimTokenRevoke();
      setPlaintext(null);
      await load();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.status === 401
            ? 'Multi-factor verification required.'
            : `Revoke failed (${err.status})`
          : err instanceof Error
            ? err.message
            : 'revoke failed';
      setError(msg);
    } finally {
      setBusy(null);
    }
  };

  const baseUrl = API_BASE || '';
  const scimBase = `${baseUrl}/scim/v2`;
  const discoveryUrl = `${scimBase}/ServiceProviderConfig`;
  const usersUrl = `${scimBase}/Users`;

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked, no-op
    }
  };

  return (
    <div className="min-h-screen bg-cm-bg text-cm-fg">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="rounded-md border border-cm-border bg-cm-subtle p-2 text-cm-accent">
              <IconShield size={22} />
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">SCIM provisioning</h1>
              <p className="text-sm text-cm-muted">
                Push user lifecycle from Okta, Azure AD, or Google Workspace.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:bg-cm-subtle hover:text-cm-fg disabled:opacity-50"
              aria-label="Refresh"
            >
              <IconRefresh size={14} />
              Refresh
            </button>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1.5 rounded-lg border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:bg-cm-subtle hover:text-cm-fg"
            >
              Settings
              <IconArrowRight size={14} />
            </Link>
          </div>
        </div>

        {loading && !view ? (
          <SettingsCardSkeleton rows={3} />
        ) : error && !view ? (
          <ErrorState title="Could not load SCIM status" message={error} onRetry={load} />
        ) : (
          <div className="grid gap-6">
            {plaintext && (
              <section
                className="rounded-xl border border-cm-cite-line bg-cm-cite-bg p-4"
                role="alert"
              >
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-cm-cite">
                  <IconWarning size={16} /> Copy this token now. It will not be shown again.
                </div>
                <div className="flex items-center gap-2">
                  <code className="cm-mono flex-1 break-all rounded-md border border-cm-cite-line bg-cm-paper px-3 py-2 text-[12px] text-cm-fg">
                    {plaintext}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy(plaintext)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-cm-cite-line px-3 py-2 text-sm text-cm-cite hover:bg-cm-paper"
                  >
                    {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="mt-2 text-xs text-cm-cite">
                  Paste into your IdP&rsquo;s SCIM connector as a bearer token, then dismiss this banner.
                </p>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setPlaintext(null)}
                    className="text-xs text-cm-cite underline hover:no-underline"
                  >
                    Dismiss
                  </button>
                </div>
              </section>
            )}

            <section className="rounded-xl border border-cm-border bg-cm-paper p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium text-cm-fg">Bearer token</h2>
                  <p className="text-xs text-cm-muted">
                    Owner-only. Each rotate requires multi-factor verification and is recorded in the audit log.
                  </p>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${
                    view?.present
                      ? 'border-[var(--cm-success)] text-cm-success'
                      : 'border-cm-border text-cm-muted'
                  }`}
                >
                  {view?.present ? <IconCheck size={12} /> : <IconKey size={12} />}
                  {view?.present ? 'Active' : 'Not configured'}
                </span>
              </div>

              {view?.present ? (
                <dl className="grid gap-2 text-sm">
                  <Row label="Token id">
                    <span className="cm-mono text-[12px] text-cm-fg">{view.id}</span>
                  </Row>
                  <Row label="Created">
                    <span className="text-cm-muted">{fmtTs(view.createdAt)}</span>
                  </Row>
                  <Row label="Created by">
                    <span className="cm-mono text-[12px] text-cm-muted">{view.createdBy ?? 'unknown'}</span>
                  </Row>
                  <Row label="Last used">
                    <span className="text-cm-muted">{fmtTs(view.lastUsedAt)}</span>
                  </Row>
                </dl>
              ) : (
                <EmptyState
                  title="No SCIM token issued"
                  body="Mint one to let your IdP provision and de-provision workspace members."
                />
              )}

              {error && (
                <p
                  role="alert"
                  className="mt-3 rounded-md border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] px-3 py-2 text-xs text-cm-danger"
                >
                  {error}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={rotate}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-cm-fg px-3 py-1.5 text-sm font-medium text-cm-bg transition hover:opacity-90 disabled:opacity-50"
                >
                  {busy === 'rotate' ? <Spinner /> : <IconRefresh size={14} />}
                  {view?.present ? 'Rotate token' : 'Mint token'}
                </button>
                {view?.present && (
                  <button
                    type="button"
                    onClick={revoke}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--cm-danger)] bg-[rgba(180,66,60,0.10)] px-3 py-1.5 text-sm font-medium text-cm-danger transition hover:bg-[rgba(180,66,60,0.18)] disabled:opacity-50"
                  >
                    {busy === 'revoke' ? <Spinner /> : <IconTrash size={14} />}
                    Revoke
                  </button>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-cm-border bg-cm-paper p-5">
              <h2 className="mb-1 text-sm font-medium text-cm-fg">Endpoints for your IdP</h2>
              <p className="mb-4 text-xs text-cm-muted">
                Paste these into Okta, Azure AD, Google Workspace, or any SCIM 2.0 connector.
              </p>
              <dl className="grid gap-2 text-sm">
                <UrlRow label="Discovery" value={discoveryUrl} onCopy={() => copy(discoveryUrl)} />
                <UrlRow label="Users base" value={usersUrl} onCopy={() => copy(usersUrl)} />
                <Row label="Auth">
                  <span className="text-cm-muted">Bearer token, header: Authorization: Bearer scim_***</span>
                </Row>
                <Row label="Content type">
                  <span className="cm-mono text-[12px] text-cm-muted">application/scim+json</span>
                </Row>
              </dl>
              <p className="mt-4 text-xs text-cm-muted">
                Supported operations: create, list, filter by userName, patch role and active, delete. Role is read
                from the schema extension{' '}
                <code className="cm-mono">urn:ietf:params:scim:schemas:extension:clawmind:2.0:User</code>.
              </p>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-center gap-3 sm:grid-cols-[160px_1fr]">
      <dt className="text-xs uppercase tracking-wide text-cm-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function UrlRow({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-center gap-3 sm:grid-cols-[160px_1fr]">
      <dt className="text-xs uppercase tracking-wide text-cm-muted">{label}</dt>
      <dd className="flex items-center gap-2">
        <code className="cm-mono flex-1 truncate rounded-md border border-cm-border bg-cm-bg px-2 py-1 text-[12px] text-cm-fg">
          {value || '(set CLAWMIND_API_BASE)'}
        </code>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2 py-1 text-xs text-cm-muted hover:bg-cm-subtle hover:text-cm-fg"
          aria-label={`Copy ${label}`}
        >
          <IconCopy size={12} />
          Copy
        </button>
      </dd>
    </div>
  );
}
