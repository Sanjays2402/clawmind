import type { BM25Index, IngestManifest, LanceStore } from '@clawmind/store';

// Consistency check across the three index stores. The ingest pipeline keeps
// them aligned (manifest + BM25 + LanceDB), but a crash mid-ingest, a
// hand-edited file, or a manual `lance delete` can leave them out of sync.
// `runDoctor` computes the deltas and emits findings the operator can act
// on without having to think about which store owns what.

export type Severity = 'info' | 'warn' | 'error';

export interface Finding {
  severity: Severity;
  code: string;
  message: string;
  hint?: string;
}

export interface DoctorReport {
  ok: boolean;
  generatedAt: number;
  counts: {
    manifestDocs: number;
    manifestChunks: number;
    bm25Chunks: number;
    lanceChunks: number;
  };
  findings: Finding[];
}

export interface DoctorOptions {
  manifest: IngestManifest;
  bm25: BM25Index;
  lance: LanceStore;
  /** Warn if no file has been ingested for at least this many ms. Default 30 days. */
  staleAfterMs?: number;
}

export async function runDoctor(opts: DoctorOptions): Promise<DoctorReport> {
  const entries = opts.manifest.entries();
  const manifestChunks = entries.reduce((acc, e) => acc + e.chunkCount, 0);
  const bm25Chunks = opts.bm25.size();
  const lanceChunks = await opts.lance.count();

  const findings: Finding[] = [];

  if (entries.length === 0) {
    findings.push({
      severity: 'warn',
      code: 'EMPTY_INDEX',
      message: 'No files are indexed yet.',
      hint: 'Run "clawmind ingest" against your workspace.',
    });
  }

  const bm25Drift = Math.abs(bm25Chunks - manifestChunks);
  if (manifestChunks > 0 && bm25Drift > 0) {
    findings.push({
      severity: bm25Drift > manifestChunks * 0.1 ? 'error' : 'warn',
      code: 'BM25_DRIFT',
      message: `BM25 has ${bm25Chunks} chunks but the manifest expects ${manifestChunks} (delta ${bm25Drift}).`,
      hint: 'Run "clawmind reindex" to rebuild from sources, or "clawmind compact" if files were deleted.',
    });
  }

  const lanceDrift = Math.abs(lanceChunks - manifestChunks);
  if (manifestChunks > 0 && lanceDrift > 0) {
    findings.push({
      severity: lanceDrift > manifestChunks * 0.1 ? 'error' : 'warn',
      code: 'LANCE_DRIFT',
      message: `LanceDB has ${lanceChunks} chunks but the manifest expects ${manifestChunks} (delta ${lanceDrift}).`,
      hint: 'Run "clawmind reindex" to repopulate the vector store.',
    });
  }

  const staleAfter = opts.staleAfterMs ?? 30 * 24 * 60 * 60 * 1000;
  if (entries.length > 0) {
    const newest = entries.reduce((acc, e) => Math.max(acc, e.ingestedAt), 0);
    const age = Date.now() - newest;
    if (age > staleAfter) {
      const days = Math.round(age / 86_400_000);
      findings.push({
        severity: 'warn',
        code: 'STALE_INDEX',
        message: `Last ingest was ${days} day(s) ago.`,
        hint: 'Run "clawmind watch" or schedule "clawmind ingest" to keep the index current.',
      });
    }
  }

  // Spot-check for manifest entries whose chunkCount is zero. Those indicate
  // a file that was loaded but produced no chunks (empty, binary, or a
  // chunker bug) and are usually safe to drop.
  const emptyDocs = entries.filter((e) => e.chunkCount === 0);
  if (emptyDocs.length > 0) {
    findings.push({
      severity: 'info',
      code: 'EMPTY_DOCS',
      message: `${emptyDocs.length} indexed file(s) produced zero chunks.`,
      hint: 'These are usually empty or binary files; consider adding them to .clawmindignore.',
    });
  }

  const ok = findings.every((f) => f.severity !== 'error');

  return {
    ok,
    generatedAt: Date.now(),
    counts: {
      manifestDocs: entries.length,
      manifestChunks,
      bm25Chunks,
      lanceChunks,
    },
    findings,
  };
}
