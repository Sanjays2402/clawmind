'use client';
import { useEffect, useState } from 'react';
import { TopNav } from '@/components/TopNav';
import { api } from '@/lib/api';
import { ErrorState, Spinner, IconDatabase, IconCheck, IconRefresh } from '@clawmind/ui';

interface IngestResult {
  added: number;
  updated: number;
  removed: number;
  corpusVersion: number;
}

export default function IngestPage() {
  const [root, setRoot] = useState('~/.openclaw/workspace');
  const [watch, setWatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [status, setStatus] = useState<{ documents: number; chunks: number; bm25: number } | null>(null);

  async function loadStatus() {
    try { setStatus(await api.ingestStatus()); } catch { /* ignore */ }
  }
  useEffect(() => { loadStatus(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!root.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.ingest(root.trim(), watch);
      setResult({ added: res.added, updated: res.updated, removed: res.removed, corpusVersion: res.corpusVersion });
      loadStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <div className="flex items-end justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Ingest a source</h1>
            <p className="mt-1 text-sm text-cm-muted">
              Point ClawMind at a directory. Files get chunked, embedded, and added to the hybrid index.
            </p>
          </div>
          <button
            onClick={loadStatus}
            className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
          >
            <IconRefresh size={14} /> Status
          </button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <StatTile label="Documents" value={status ? status.documents.toLocaleString() : '...'} />
          <StatTile label="Chunks" value={status ? status.chunks.toLocaleString() : '...'} />
          <StatTile label="BM25 terms" value={status ? status.bm25.toLocaleString() : '...'} />
        </div>

        <form onSubmit={submit} className="mt-6 cm-card p-5">
          <label className="block text-sm font-medium">Root path</label>
          <input
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            placeholder="~/.openclaw/workspace"
            className="mt-2 w-full rounded-md border border-cm-border bg-cm-bg px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-cm-accent"
            spellCheck={false}
            autoCorrect="off"
          />
          <p className="mt-1 text-xs text-cm-muted">
            Supports tilde expansion. Hidden files and node_modules are skipped by default.
          </p>

          <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={watch}
              onChange={(e) => setWatch(e.target.checked)}
              className="h-4 w-4 accent-[color:var(--cm-accent)]"
            />
            Keep watching after ingest, so edits update the index live.
          </label>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="submit"
              disabled={busy || !root.trim()}
              className="inline-flex items-center gap-2 rounded-md bg-cm-accent px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50"
            >
              {busy ? <Spinner size={14} /> : <IconDatabase size={16} />}
              {busy ? 'Ingesting' : 'Run ingest'}
            </button>
            {busy && <span className="text-sm text-cm-muted">This can take a minute on a large workspace.</span>}
          </div>
        </form>

        {error && (
          <div className="mt-4">
            <ErrorState message={error} onRetry={() => setError(null)} retryLabel="Dismiss" />
          </div>
        )}

        {result && (
          <div className="mt-4 cm-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-cm-success">
              <IconCheck size={16} /> Ingest complete
            </div>
            <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
              <div><span className="text-cm-muted">Added: </span>{result.added}</div>
              <div><span className="text-cm-muted">Updated: </span>{result.updated}</div>
              <div><span className="text-cm-muted">Removed: </span>{result.removed}</div>
            </div>
            <div className="mt-2 text-xs text-cm-muted">Corpus version now {result.corpusVersion}.</div>
          </div>
        )}
      </div>
    </main>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="cm-card p-3">
      <div className="text-[11px] uppercase tracking-wide text-cm-muted">{label}</div>
      <div className="mt-0.5 text-lg font-semibold">{value}</div>
    </div>
  );
}
