'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, ApiError } from '@/lib/api';
import {
  Button,
  Card,
  ErrorState,
  Spinner,
  IconArchive,
  IconArrowRight,
  IconDownload,
  IconRefresh,
  IconShield,
} from '@clawmind/ui';

// Tenant-wide GDPR / data-portability export. Owner-only. The button-driven
// flow is intentional: a buyer's compliance reviewer wants to click once,
// inspect the preview (counts + estimated bytes), then trigger the real
// download. No CLI ceremony, no piping JSON to curl in a runbook.

interface Preview {
  schema: string;
  dryRun: true;
  previewedAt: number;
  estimatedBytes: number;
  counts: Record<string, number>;
}

const LABELS: Record<string, string> = {
  members: 'Members',
  history: 'History entries',
  conversations: 'Conversations',
  saved: 'Saved searches',
  feedback: 'Feedback rows',
  apiKeys: 'API keys',
  pins: 'Pins',
  mutes: 'Mutes',
  aliases: 'Aliases',
  tags: 'Tags',
  collections: 'Collections',
  domainPolicies: 'Domain policies',
  ipAllowlist: 'IP allowlist entries',
  webhookAllowlist: 'Webhook allowlist entries',
  webhooks: 'Webhooks',
  invitations: 'Invitations',
  auditEvents: 'Audit events',
  ingestDocs: 'Indexed documents',
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function WorkspaceExportPage() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await api.workspaceExportPreview();
      setPreview(p);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('Only workspace owners can export tenant-wide data.');
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

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <TopNav />
      <header className="space-y-2">
        <div className="text-sm text-fg-muted flex items-center gap-2">
          <Link href="/settings" className="hover:underline">Settings</Link>
          <IconArrowRight className="w-3.5 h-3.5" />
          <span>Workspace export</span>
        </div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <IconArchive className="w-6 h-6" />
          Workspace export
        </h1>
        <p className="text-fg-muted">
          Download every workspace-scoped record &mdash; members, history,
          conversations, saved searches, feedback, API key metadata, audit
          chain, ingest manifest. Stripped of secret material (hashes, OIDC
          client secrets, MFA seeds). Required by enterprise data-portability
          and exit clauses.
        </p>
        <p className="text-xs text-fg-muted">
          Owner-only. Every export and preview is recorded in the audit log
          with your user id, IP, and timestamp.
        </p>
      </header>

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorState message={error} />
      ) : preview ? (
        <Card className="p-5 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm uppercase tracking-wider text-fg-muted">
                Estimated bundle
              </div>
              <div className="text-2xl font-semibold">
                {fmtBytes(preview.estimatedBytes)}
              </div>
              <div className="text-xs text-fg-muted">
                Previewed {new Date(preview.previewedAt).toLocaleString()}
              </div>
            </div>
            <Button onClick={() => void load()} variant="ghost">
              <IconRefresh className="w-4 h-4 mr-1" /> Refresh
            </Button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {Object.entries(preview.counts).map(([key, val]) => (
              <div key={key} className="rounded-md border border-border p-3">
                <div className="text-xs text-fg-muted">
                  {LABELS[key] ?? key}
                </div>
                <div className="text-lg font-medium tabular-nums">{val}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <a href={api.workspaceExportJsonUrl()} download>
              <Button>
                <IconDownload className="w-4 h-4 mr-1" />
                Download JSON
              </Button>
            </a>
            <a href={api.workspaceExportZipUrl()} download>
              <Button variant="ghost">
                <IconArchive className="w-4 h-4 mr-1" />
                Download ZIP
              </Button>
            </a>
          </div>

          <p className="text-xs text-fg-muted flex items-start gap-2">
            <IconShield className="w-4 h-4 mt-0.5 flex-none" />
            <span>
              The export bundle never contains bcrypt hashes, API-key secret
              material, OIDC client secrets, MFA TOTP seeds, or SMTP
              credentials. It is portable but cannot be replayed to
              re-impersonate users on a different deployment.
            </span>
          </p>
        </Card>
      ) : null}
    </main>
  );
}
