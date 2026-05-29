import { extname } from 'node:path';
import fg from 'fast-glob';
import PQueue from 'p-queue';
import type { Chunk, EmbedProvider } from '@clawmind/types';
import { BM25Index, IngestManifest, LanceStore } from '@clawmind/store';
import { embedAll, EmbedCache } from '@clawmind/embed';
import { loadMarkdown } from './loaders/markdown.js';
import { loadCode, isCodeFile } from './loaders/code.js';
import { loadJson } from './loaders/json.js';
import { semanticChunk } from './chunkers/semantic.js';

export interface IngestOptions {
  store: LanceStore;
  bm25: BM25Index;
  bm25File: string;
  manifest: IngestManifest;
  embed: EmbedProvider;
  embedModel: string;
  concurrency?: number;
  onProgress?: (info: { processed: number; total: number; path: string }) => void;
}

const INCLUDE_GLOBS = [
  '**/*.md', '**/*.mdx', '**/*.txt', '**/*.json',
  '**/*.ts', '**/*.tsx', '**/*.js', '**/*.py', '**/*.go', '**/*.rs',
  '**/*.yml', '**/*.yaml', '**/*.toml',
];
const EXCLUDE_GLOBS = [
  '**/node_modules/**', '**/.git/**', '**/.next/**', '**/dist/**', '**/build/**',
  '**/coverage/**', '**/.turbo/**', '**/.venv/**', '**/data/**', '**/.lancedb/**',
];

export async function discoverFiles(root: string): Promise<string[]> {
  return fg(INCLUDE_GLOBS, { cwd: root, ignore: EXCLUDE_GLOBS, absolute: true, dot: false });
}

async function loadByExt(path: string) {
  const ext = extname(path).toLowerCase();
  if (ext === '.md' || ext === '.mdx' || ext === '.txt') return loadMarkdown(path);
  if (ext === '.json') return loadJson(path);
  if (isCodeFile(path)) return loadCode(path);
  return loadMarkdown(path);
}

export async function ingestRoot(root: string, opts: IngestOptions): Promise<{ processed: number; skipped: number; chunks: number }> {
  const files = await discoverFiles(root);
  return ingestPaths(files, opts);
}

export async function ingestPaths(files: string[], opts: IngestOptions): Promise<{ processed: number; skipped: number; chunks: number }> {
  const queue = new PQueue({ concurrency: opts.concurrency ?? 4 });
  const cache = new EmbedCache();
  let processed = 0;
  let skipped = 0;
  let chunkTotal = 0;

  await Promise.all(
    files.map((path) =>
      queue.add(async () => {
        try {
          const { doc, body } = await loadByExt(path);
          if (!opts.manifest.needsReindex(doc.path, doc.hash, doc.mtime)) {
            skipped += 1;
            return;
          }
          await opts.store.deleteByDocument(doc.id);
          opts.bm25.removeByDocumentId(doc.id);

          const chunks: Chunk[] = semanticChunk(doc, body);
          if (chunks.length === 0) {
            skipped += 1;
            return;
          }
          const vectors = await embedAll(opts.embed, chunks.map((c) => c.text), {
            cache, model: opts.embedModel,
          });
          for (let i = 0; i < chunks.length; i++) chunks[i]!.embedding = vectors[i];

          await opts.store.upsert(chunks);
          opts.bm25.add(chunks);
          opts.manifest.set({
            path: doc.path, hash: doc.hash, mtime: doc.mtime, size: doc.size,
            documentId: doc.id, chunkCount: chunks.length, ingestedAt: Date.now(),
          });
          processed += 1;
          chunkTotal += chunks.length;
          opts.onProgress?.({ processed, total: files.length, path });
        } catch (err) {
          skipped += 1;
          process.stderr.write(`ingest failed for ${path}: ${(err as Error).message}\n`);
        }
      }),
    ),
  );
  await opts.manifest.save();
  await opts.bm25.save(opts.bm25File);
  return { processed, skipped, chunks: chunkTotal };
}
