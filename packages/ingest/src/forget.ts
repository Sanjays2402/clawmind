import picomatch from 'picomatch';
import type { BM25Index, IngestManifest, LanceStore } from '@clawmind/store';

// Bulk "forget": remove every indexed source whose path matches one or more
// glob patterns (or, when patterns is empty, every entry whose path starts
// with one of the given prefixes). Operates on the same three stores as
// `compactStore` (manifest, BM25, LanceDB) so the index stays consistent.
//
// Globs are matched against the absolute path that the manifest stores, so
// patterns like `**/scratch/**` or `/Users/me/notes/private/**` both work.
// `dryRun` returns the would-be-removed paths without mutating state, which
// is what backs the API's confirmation flow.

export interface ForgetOptions {
  manifest: IngestManifest;
  bm25: BM25Index;
  bm25File: string;
  lance: LanceStore;
  /** Glob patterns (picomatch syntax). Matched against absolute paths. */
  patterns: string[];
  dryRun?: boolean;
}

export interface ForgetReport {
  matched: number;
  removedChunks: number;
  removedPaths: string[];
  dryRun: boolean;
}

export async function forgetSources(opts: ForgetOptions): Promise<ForgetReport> {
  if (opts.patterns.length === 0) {
    return { matched: 0, removedChunks: 0, removedPaths: [], dryRun: !!opts.dryRun };
  }
  const matchers = opts.patterns.map((p) =>
    picomatch(p, { dot: true, nocase: process.platform === 'darwin' || process.platform === 'win32' }),
  );
  const isMatch = (path: string) => matchers.some((m) => m(path));

  const entries = opts.manifest.entries();
  const targets = entries.filter((e) => isMatch(e.path));
  let removedChunks = 0;

  if (!opts.dryRun) {
    for (const e of targets) {
      await opts.lance.deleteByDocument(e.documentId);
      opts.bm25.removeByDocumentId(e.documentId);
      opts.manifest.delete(e.path);
      removedChunks += e.chunkCount;
    }
    if (targets.length > 0) {
      await opts.manifest.save();
      await opts.bm25.save(opts.bm25File);
    }
  } else {
    removedChunks = targets.reduce((acc, e) => acc + e.chunkCount, 0);
  }

  return {
    matched: targets.length,
    removedChunks,
    removedPaths: targets.map((e) => e.path),
    dryRun: !!opts.dryRun,
  };
}
