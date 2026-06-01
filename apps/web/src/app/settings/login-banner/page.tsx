'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  type LoginBanner,
  type LoginBannerSeverity,
  type LoginBannerAck,
  ApiError,
} from '@/lib/api';
import {
  ErrorState,
  Spinner,
  IconArrowRight,
  IconCheck,
  IconShield,
  IconWarning,
} from '@clawmind/ui';

function fmtDate(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

const SEVERITY_OPTIONS: ReadonlyArray<{ value: LoginBannerSeverity; label: string }> = [
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning' },
  { value: 'critical', label: 'Critical' },
];

export default function LoginBannerPage() {
  const [banner, setBanner] = useState<LoginBanner | null>(null);
  const [acks, setAcks] = useState<LoginBannerAck[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<LoginBannerSeverity>('info');
  const [requireAck, setRequireAck] = useState(false);

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const b = await api.loginBannerGet();
      setBanner(b);
      setEnabled(b.enabled);
      setTitle(b.title);
      setBody(b.body);
      setSeverity(b.severity);
      setRequireAck(b.requireAck);
      try {
        const ledger = await api.loginBannerAcks();
        setAcks(ledger.acks);
      } catch (err) {
        // Admin-only endpoint. Plain members see the editor but not the
        // ledger; this is intentional, not an error.
        if (!(err instanceof ApiError) || err.status !== 403) {
          throw err;
        }
        setAcks(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setSaving(true);
    try {
      const next = await api.loginBannerPublish({
        enabled, title, body, severity, requireAck,
      });
      setBanner(next);
      setSavedAt(Date.now());
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.status}: ${err.message}` : err instanceof Error ? err.message : 'save failed';
      setActionError(msg);
    } finally {
      setSaving(false);
    }
  };

  const disable = async () => {
    setActionError(null);
    setSaving(true);
    try {
      const next = await api.loginBannerDisable();
      setBanner(next);
      setEnabled(false);
      setRequireAck(false);
      setSavedAt(Date.now());
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.status}: ${err.message}` : err instanceof Error ? err.message : 'disable failed';
      setActionError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-3 text-sm text-muted-foreground">
          <Link href="/settings" className="hover:text-foreground">Settings</Link>
          <IconArrowRight size={14} />
          <span className="text-foreground">Login banner</span>
        </div>

        <header className="mb-8">
          <div className="flex items-start gap-3">
            <IconShield size={28} className="mt-1 text-primary" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">System use notification</h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Show a banner on the login page and require every member to acknowledge it once per session before writing.
                Required by NIST 800-53 AC-8 and FedRAMP. API key callers are exempt.
              </p>
            </div>
          </div>
        </header>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading banner
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <>
            <form
              onSubmit={save}
              className="space-y-6 rounded-lg border bg-card p-6 shadow-sm"
            >
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-input"
                />
                <span>
                  <span className="block text-sm font-medium">Enable banner</span>
                  <span className="block text-xs text-muted-foreground">
                    When on, /v1/login-banner returns the published text. Login pages render it prior to authentication.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={requireAck}
                  onChange={(e) => setRequireAck(e.target.checked)}
                  disabled={!enabled}
                  className="mt-1 h-4 w-4 rounded border-input"
                />
                <span>
                  <span className="block text-sm font-medium">Require acknowledgment</span>
                  <span className="block text-xs text-muted-foreground">
                    Every signed-in session must POST /v1/login-banner/ack with the current bodyHash before any mutating request is accepted. Mutations return 412 until acknowledged.
                  </span>
                </span>
              </label>

              <div className="space-y-2">
                <label htmlFor="lb-title" className="block text-sm font-medium">Title</label>
                <input
                  id="lb-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  placeholder="System Use Notice"
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="lb-body" className="block text-sm font-medium">Body (markdown allowed)</label>
                <textarea
                  id="lb-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={16 * 1024}
                  rows={8}
                  placeholder="WARNING: Authorized use only. Activity may be monitored and recorded."
                  className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  {body.length} of {16 * 1024} characters. Updating the body invalidates every prior acknowledgment.
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor="lb-sev" className="block text-sm font-medium">Severity</label>
                <select
                  id="lb-sev"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as LoginBannerSeverity)}
                  className="w-48 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                >
                  {SEVERITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {actionError ? (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  <IconWarning size={16} />
                  <span>{actionError}</span>
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3 border-t pt-4">
                <p className="text-xs text-muted-foreground">
                  Last published by{' '}
                  <span className="font-mono">{banner?.publishedBy ?? 'never'}</span>{' '}
                  on {fmtDate(banner?.publishedAt ?? null)}.
                </p>
                <div className="flex gap-2">
                  {banner?.enabled ? (
                    <button
                      type="button"
                      onClick={disable}
                      disabled={saving}
                      className="rounded-md border border-input px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                    >
                      Disable
                    </button>
                  ) : null}
                  <button
                    type="submit"
                    disabled={saving || !title || !body}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {saving ? <Spinner /> : <IconCheck size={16} />}
                    Save banner
                  </button>
                </div>
              </div>

              {savedAt ? (
                <p className="text-xs text-muted-foreground">Saved {fmtDate(savedAt)}.</p>
              ) : null}
            </form>

            {acks !== null ? (
              <section className="mt-10">
                <h2 className="mb-3 text-base font-semibold">Recent acknowledgments</h2>
                {acks.length === 0 ? (
                  <p className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
                    No acknowledgments recorded yet. They appear here as members sign in and accept the banner on each session.
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-lg border bg-card">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left">User</th>
                          <th className="px-3 py-2 text-left">Session</th>
                          <th className="px-3 py-2 text-left">IP</th>
                          <th className="px-3 py-2 text-left">Acknowledged</th>
                        </tr>
                      </thead>
                      <tbody>
                        {acks.slice(0, 50).map((a) => (
                          <tr key={`${a.sessionIdHash}-${a.ackedAt}`} className="border-t">
                            <td className="px-3 py-2 font-mono text-xs">{a.userId}</td>
                            <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{a.sessionIdHash.slice(0, 12)}</td>
                            <td className="px-3 py-2 text-xs">{a.ip ?? '-'}</td>
                            <td className="px-3 py-2 text-xs">{fmtDate(a.ackedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {acks.length > 50 ? (
                      <p className="border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                        Showing 50 of {acks.length} acknowledgments. The full ledger is available at GET /v1/login-banner/acks.
                      </p>
                    ) : null}
                  </div>
                )}
              </section>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
