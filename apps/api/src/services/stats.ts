import { extname } from 'node:path';
import { inferNamespace } from '@clawmind/ingest';
import type { IngestManifest, ManifestEntry } from '@clawmind/store';

// Aggregate per-namespace stats from the ingest manifest. The manifest is
// already the source of truth for "what is currently indexed" so we read
// from it rather than scanning LanceDB or the BM25 index directly. That
// keeps stats cheap (one in-memory pass over a small list) and consistent
// with what /v1/ingest/compact would consider orphaned.

export interface NamespaceStats {
  namespace: string;
  files: number;
  chunks: number;
  bytes: number;
  /** Oldest ingestedAt timestamp in ms (most stale file in the namespace). */
  oldestIngestedAt: number | null;
  /** Newest ingestedAt timestamp in ms. */
  newestIngestedAt: number | null;
  /** Top extensions by file count, descending. */
  extensions: { ext: string; count: number }[];
}

export interface StatsReport {
  totals: {
    files: number;
    chunks: number;
    bytes: number;
    namespaces: number;
  };
  byNamespace: NamespaceStats[];
  generatedAt: number;
}

function bucketExt(path: string): string {
  const e = extname(path).toLowerCase();
  return e === '' ? '(none)' : e;
}

function emptyStats(ns: string): NamespaceStats {
  return {
    namespace: ns,
    files: 0,
    chunks: 0,
    bytes: 0,
    oldestIngestedAt: null,
    newestIngestedAt: null,
    extensions: [],
  };
}

export function computeStats(entries: ManifestEntry[]): StatsReport {
  const grouped = new Map<string, NamespaceStats>();
  const extCounts = new Map<string, Map<string, number>>();

  for (const e of entries) {
    const ns = inferNamespace(e.path);
    let s = grouped.get(ns);
    if (!s) {
      s = emptyStats(ns);
      grouped.set(ns, s);
      extCounts.set(ns, new Map());
    }
    s.files += 1;
    s.chunks += e.chunkCount;
    s.bytes += e.size;
    if (s.oldestIngestedAt === null || e.ingestedAt < s.oldestIngestedAt) s.oldestIngestedAt = e.ingestedAt;
    if (s.newestIngestedAt === null || e.ingestedAt > s.newestIngestedAt) s.newestIngestedAt = e.ingestedAt;
    const ext = bucketExt(e.path);
    const m = extCounts.get(ns)!;
    m.set(ext, (m.get(ext) ?? 0) + 1);
  }

  for (const [ns, s] of grouped) {
    const m = extCounts.get(ns)!;
    s.extensions = [...m.entries()]
      .map(([ext, count]) => ({ ext, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }

  const byNamespace = [...grouped.values()].sort((a, b) => b.chunks - a.chunks);
  const totals = byNamespace.reduce(
    (acc, s) => {
      acc.files += s.files;
      acc.chunks += s.chunks;
      acc.bytes += s.bytes;
      return acc;
    },
    { files: 0, chunks: 0, bytes: 0, namespaces: byNamespace.length },
  );

  return { totals, byNamespace, generatedAt: Date.now() };
}

export async function statsFromManifest(manifest: IngestManifest): Promise<StatsReport> {
  return computeStats(manifest.entries());
}
