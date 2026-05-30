'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { TopNav } from '@/components/TopNav';
import {
  api,
  fmtRelative,
  type SnapshotEntry,
  type SnapshotDiff,
  type Source,
} from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  Spinner,
  IconArrowRight,
  IconRefresh,
  IconWarning,
  IconFolder,
} from '@clawmind/ui';

interface DiffResult { diff: SnapshotDiff; current: Source[] }

export default function SnapshotDetailPage() {
  const params = useParams<{ id: string; snapId: string }>();
  const { id: savedId, snapId } = params;

  const [snapshot, setSnapshot] = useState<SnapshotEntry | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSnap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snap = await api.snapshotGet(savedId, snapId);
      setSnapshot(snap);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [savedId, snapId]);

  const runDiff = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await api.snapshotDiff(savedId, snapId);
      setDiff(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }, [savedId, snapId]);

  useEffect(() => { loadSnap(); }, [loadSnap]);

  return (
    <main className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <div className="text-xs text-cm-muted">
          <Link href="/saved" className="text-cm-accent">Saved</Link> /{' '}
          <Link href={`/saved/${savedId}/snapshots`} className="text-cm-accent">Snapshots</Link> /{' '}
          <span className="font-mono">{snapId.slice(0, 8)}</span>
        </div>

        <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">
              {snapshot?.label ?? 'Snapshot'}
            </h1>
            <p className="mt-1 text-sm text-cm-muted">
              {snapshot
                ? `Captured ${fmtRelative(snapshot.ts)} with ${snapshot.sources.length} sources.`
                : 'Loading snapshot.'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={loadSnap}
              className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-3 py-1.5 text-sm text-cm-muted hover:text-cm-fg"
            >
              <IconRefresh size={14} /> Reload
            </button>
            <button
              onClick={runDiff}
              disabled={running || !snapshot}
              className="inline-flex items-center gap-1.5 rounded-md bg-cm-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {running ? <Spinner size={14} /> : <IconArrowRight size={14} />}
              Diff against latest
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4">
            <ErrorState message={error} onRetry={() => setError(null)} retryLabel="Dismiss" />
          </div>
        )}

        {loading && !snapshot ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : !snapshot ? (
          <EmptyState title="Snapshot not found" body="It may have been deleted." />
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Column
              title="Baseline"
              subtitle={`${snapshot.sources.length} sources, ${fmtRelative(snapshot.ts)}`}
              sources={snapshot.sources}
              tone="baseline"
              emptyHint="The captured snapshot held no sources."
            />
            {!diff ? (
              <div className="cm-card flex flex-col items-center justify-center gap-3 p-10 text-center">
                <IconWarning className="text-cm-muted" />
                <div className="text-sm text-cm-muted">
                  Run a diff to fetch fresh results and compare.
                </div>
              </div>
            ) : (
              <DiffPanel diff={diff.diff} current={diff.current} />
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function DiffPanel({ diff, current }: { diff: SnapshotDiff; current: Source[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="cm-card grid grid-cols-3 gap-2 p-4 text-center text-sm">
        <Stat label="added" value={diff.added.length} tone="success" />
        <Stat label="removed" value={diff.removed.length} tone="danger" />
        <Stat label="unchanged" value={diff.unchanged.length} tone="muted" />
      </div>
      {diff.added.length > 0 && (
        <SourceBlock title={`Added (${diff.added.length})`} tone="success" sources={diff.added} />
      )}
      {diff.removed.length > 0 && (
        <SourceBlock title={`Removed (${diff.removed.length})`} tone="danger" sources={diff.removed} />
      )}
      {diff.added.length === 0 && diff.removed.length === 0 && (
        <div className="cm-card p-5 text-sm text-cm-muted">
          Top results match the baseline. Nothing has shifted.
        </div>
      )}
      <details className="cm-card p-4 text-sm">
        <summary className="cursor-pointer text-cm-muted">
          Current top {current.length} sources
        </summary>
        <ul className="mt-3 divide-y divide-cm-border">
          {current.map((s) => <SourceRow key={s.id} source={s} />)}
        </ul>
      </details>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'success' | 'danger' | 'muted' }) {
  const cls = tone === 'success' ? 'text-cm-success' : tone === 'danger' ? 'text-cm-danger' : 'text-cm-muted';
  return (
    <div>
      <div className={`text-2xl font-semibold ${cls}`}>{value}</div>
      <div className="text-xs text-cm-muted">{label}</div>
    </div>
  );
}

function Column({
  title,
  subtitle,
  sources,
  tone,
  emptyHint,
}: {
  title: string;
  subtitle: string;
  sources: Source[];
  tone: 'baseline';
  emptyHint: string;
}) {
  void tone;
  return (
    <div className="cm-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="mt-0.5 text-xs text-cm-muted">{subtitle}</div>
        </div>
      </div>
      <div className="mt-3">
        {sources.length === 0 ? (
          <div className="py-6 text-center text-sm text-cm-muted">{emptyHint}</div>
        ) : (
          <ul className="divide-y divide-cm-border">
            {sources.map((s) => <SourceRow key={s.id} source={s} />)}
          </ul>
        )}
      </div>
    </div>
  );
}

function SourceBlock({ title, tone, sources }: { title: string; tone: 'success' | 'danger'; sources: Source[] }) {
  const accent = tone === 'success' ? 'text-cm-success' : 'text-cm-danger';
  return (
    <div className="cm-card p-4">
      <div className={`text-sm font-medium ${accent}`}>{title}</div>
      <ul className="mt-3 divide-y divide-cm-border">
        {sources.map((s) => <SourceRow key={s.id} source={s} />)}
      </ul>
    </div>
  );
}

function SourceRow({ source }: { source: Source }) {
  return (
    <li className="py-2.5">
      <div className="flex items-center gap-2 text-xs text-cm-muted">
        <IconFolder size={12} />
        <span>lines {source.startLine}-{source.endLine}</span>
        <span>·</span>
        <span>score {source.score.toFixed(3)}</span>
      </div>
      <Link
        href={`/sources/view?path=${encodeURIComponent(source.path)}`}
        className="mt-0.5 block break-all font-mono text-sm text-cm-fg hover:text-cm-accent"
      >
        {source.displayPath ?? source.path}
      </Link>
      {source.excerpt && (
        <p className="mt-1 line-clamp-2 text-sm text-cm-muted">{source.excerpt}</p>
      )}
    </li>
  );
}
