import { stat } from 'node:fs/promises';
import type { BM25Index, IngestManifest, LanceStore } from '@clawmind/store';

// Compaction reconciles the manifest, the BM25 index, and the LanceDB table
// with the current state of the filesystem.
//
// For every manifest entry we stat the source path. If the file is gone we
// remove its chunks from BM25, drop its row group from LanceDB, and forget the
// manifest entry. We never re-embed during compaction, so it is cheap to run.
//
// The function is deliberately decoupled from the ingest pipeline so a watcher
// or a cron can call it without dragging in the loaders.

export interface CompactOptions {
  manifest: IngestManifest;
  bm25: BM25Index;
  bm25File: string;
  lance: LanceStore;
  /** When true, report what would be done without mutating any state. */
  dryRun?: boolean;
  /** Inject a stat for tests; defaults to fs.stat. */
  statFn?: (path: string) => Promise<{ isFile(): boolean } | null>;
}

export interface CompactReport {
  scanned: number;
  removed: number;
  kept: number;
  removedPaths: string[];
  dryRun: boolean;
}

async function defaultStat(path: string) {
  try {
    return await stat(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function compactStore(opts: CompactOptions): Promise<CompactReport> {
  const statFn = opts.statFn ?? defaultStat;
  const entries = opts.manifest.entries();
  const removedPaths: string[] = [];

  for (const entry of entries) {
    const s = await statFn(entry.path);
    const missing = !s || !s.isFile();
    if (missing) removedPaths.push(entry.path);
  }

  if (!opts.dryRun) {
    for (const p of removedPaths) {
      const entry = opts.manifest.get(p);
      if (!entry) continue;
      await opts.lance.deleteByDocument(entry.documentId);
      opts.bm25.removeByDocumentId(entry.documentId);
      opts.manifest.delete(p);
    }
    if (removedPaths.length > 0) {
      await opts.manifest.save();
      await opts.bm25.save(opts.bm25File);
    }
  }

  return {
    scanned: entries.length,
    removed: removedPaths.length,
    kept: entries.length - removedPaths.length,
    dryRun: !!opts.dryRun,
    removedPaths,
  };
}
