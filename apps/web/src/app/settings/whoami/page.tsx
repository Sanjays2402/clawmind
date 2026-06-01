'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, type WhoamiEnvelope } from '@/lib/api';
import {
  Button,
  Card,
  ErrorState,
  Spinner,
  IconArrowRight,
  IconCopy,
  IconKey,
  IconNetwork,
  IconRefresh,
  IconShield,
  IconUsers,
} from '@clawmind/ui';

// Token / session debugger. The page every customer integrator opens at
// 02:00 when their CI starts returning 401 or 403 against ClawMind. It
// reflects exactly what the server thinks about the current browser
// session (or, when curl'd with an Authorization header, the API key
// behind that header). Nothing here is workspace data; the API endpoint
// is safe to hit anonymously and returns authenticated:false in that
// case so the UI can render a clean signed-out state.

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span className="cm-mono rounded bg-[var(--bg-muted)] px-1.5 py-0.5 text-[12px] text-[var(--fg)]">
      {children}
    </span>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-3 py-1.5 text-sm">
      <div className="text-[var(--fg-muted)]">{label}</div>
      <div className="text-[var(--fg)]">{value}</div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard can be blocked by browser permissions. Silent failure
          // is fine; the value is already visible on screen.
        }
      }}
      className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--fg-muted)] hover:bg-[var(--bg-muted)]"
      aria-label="Copy to clipboard"
    >
      <IconCopy size={12} />
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function WhoamiPage() {
  const [data, setData] = useState<WhoamiEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const env = await api.whoami();
      setData(env);
      setRefreshedAt(Date.now());
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
    <main className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <TopNav />
      <header className="space-y-2">
        <div className="text-sm text-[var(--fg-muted)] flex items-center gap-2">
          <Link href="/settings" className="hover:underline">Settings</Link>
          <IconArrowRight size={12} />
          <span>Identity</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Who am I</h1>
        <p className="text-sm text-[var(--fg-muted)]">
          The server&rsquo;s view of this request: the user behind the session, the API key
          behind a token, the scopes that key was granted, the source IP, and the request
          id the audit log will use. Share the request id with support when you open a
          ticket so they can find the exact event in the audit chain.
        </p>
      </header>

      <div className="flex items-center gap-2">
        <Button onClick={() => void load()} disabled={loading} variant="ghost">
          <IconRefresh size={14} /> Refresh
        </Button>
        {refreshedAt ? (
          <span className="text-xs text-[var(--fg-muted)]">
            Updated {new Date(refreshedAt).toLocaleTimeString()}
          </span>
        ) : null}
      </div>

      {loading && !data ? (
        <Card>
          <div className="flex items-center gap-2 p-6 text-sm text-[var(--fg-muted)]">
            <Spinner /> Loading identity
          </div>
        </Card>
      ) : error ? (
        <ErrorState title="Could not load identity" message={error} onRetry={() => void load()} />
      ) : !data ? null : (
        <div className="space-y-4">
          <Card>
            <div className="p-5 space-y-1">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <IconShield size={14} className="text-[var(--fg-muted)]" />
                Authentication
              </div>
              <Row
                label="Status"
                value={
                  data.authenticated ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[12px] text-emerald-500">
                      Authenticated
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-muted)] px-2 py-0.5 text-[12px] text-[var(--fg-muted)]">
                      Anonymous
                    </span>
                  )
                }
              />
              <Row label="Via" value={<Mono>{data.via}</Mono>} />
              {data.elevation ? (
                <Row
                  label="Elevation"
                  value={
                    <span className="text-[12px] text-[var(--fg)]">
                      <Mono>{data.elevation.fromRole}</Mono> &rarr; <Mono>{data.elevation.toRole}</Mono>{' '}
                      <span className="text-[var(--fg-muted)]">
                        until {new Date(data.elevation.expiresAt).toLocaleString()}
                      </span>
                    </span>
                  }
                />
              ) : null}
            </div>
          </Card>

          <Card>
            <div className="p-5 space-y-1">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <IconUsers size={14} className="text-[var(--fg-muted)]" />
                User
              </div>
              <Row label="User id" value={data.user.id ? <Mono>{data.user.id}</Mono> : <span className="text-[var(--fg-muted)]">none</span>} />
              <Row label="Role" value={data.user.role ? <Mono>{data.user.role}</Mono> : <span className="text-[var(--fg-muted)]">none</span>} />
              <Row label="Email" value={data.user.email ?? <span className="text-[var(--fg-muted)]">unknown</span>} />
              <Row label="GitHub" value={data.user.github ? <Mono>{data.user.github}</Mono> : <span className="text-[var(--fg-muted)]">not linked</span>} />
            </div>
          </Card>

          <Card>
            <div className="p-5 space-y-1">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <IconKey size={14} className="text-[var(--fg-muted)]" />
                API key
              </div>
              {data.apiKey ? (
                <>
                  <Row
                    label="Key id"
                    value={
                      <span className="flex items-center gap-2">
                        <Mono>{data.apiKey.id ?? 'unknown'}</Mono>
                        {data.apiKey.id ? <CopyButton text={data.apiKey.id} /> : null}
                      </span>
                    }
                  />
                  <Row
                    label="Scopes"
                    value={
                      data.apiKey.scopes && data.apiKey.scopes.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {data.apiKey.scopes.map((s) => (
                            <Mono key={s}>{s}</Mono>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[var(--fg-muted)]">unrestricted (legacy key)</span>
                      )
                    }
                  />
                </>
              ) : (
                <p className="text-sm text-[var(--fg-muted)]">
                  This request was not authenticated with an API key. Issue one from{' '}
                  <Link href="/keys" className="underline">/keys</Link> and curl{' '}
                  <Mono>GET /v1/whoami</Mono> with{' '}
                  <Mono>Authorization: Bearer &lt;key&gt;</Mono> to see what that key can do.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <div className="p-5 space-y-1">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <IconNetwork size={14} className="text-[var(--fg-muted)]" />
                Request
              </div>
              <Row
                label="Request id"
                value={
                  <span className="flex items-center gap-2">
                    <Mono>{data.request.id}</Mono>
                    <CopyButton text={data.request.id} />
                  </span>
                }
              />
              <Row label="Source IP" value={<Mono>{data.request.ip}</Mono>} />
              <Row
                label="Forwarded for"
                value={
                  data.request.forwardedFor ? (
                    <Mono>{data.request.forwardedFor}</Mono>
                  ) : (
                    <span className="text-[var(--fg-muted)]">none</span>
                  )
                }
              />
              <Row
                label="User-Agent"
                value={
                  data.request.userAgent ? (
                    <span className="break-all text-[12px] text-[var(--fg)]">{data.request.userAgent}</span>
                  ) : (
                    <span className="text-[var(--fg-muted)]">unknown</span>
                  )
                }
              />
              <Row label="Server time" value={<Mono>{new Date(data.request.serverTime).toISOString()}</Mono>} />
            </div>
          </Card>

          <details className="rounded-lg border border-[var(--border)] bg-[var(--bg-muted)] p-3 text-sm">
            <summary className="cursor-pointer text-[var(--fg)]">Raw JSON</summary>
            <pre className="mt-2 overflow-x-auto rounded bg-[var(--bg)] p-3 text-[12px] text-[var(--fg)]">
{JSON.stringify(data, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </main>
  );
}
