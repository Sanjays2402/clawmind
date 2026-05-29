import chokidar from 'chokidar';
import { ingestPaths, type IngestOptions } from './pipeline.js';

export interface WatcherOptions extends IngestOptions {
  root: string;
  debounceMs?: number;
  onEvent?: (kind: 'add' | 'change' | 'unlink', path: string) => void;
}

export function startWatcher(opts: WatcherOptions) {
  const debounce = opts.debounceMs ?? 800;
  const pending = new Map<string, NodeJS.Timeout>();

  const watcher = chokidar.watch(opts.root, {
    ignoreInitial: true,
    ignored: (p) => /node_modules|\.git|\.next|dist|\.turbo|\.venv|data\/?|\.lancedb/.test(p),
  });

  const schedule = (kind: 'add' | 'change' | 'unlink', path: string) => {
    opts.onEvent?.(kind, path);
    const prev = pending.get(path);
    if (prev) clearTimeout(prev);
    pending.set(path, setTimeout(async () => {
      pending.delete(path);
      if (kind === 'unlink') {
        const entry = opts.manifest.get(path);
        if (entry) {
          await opts.store.deleteByDocument(entry.documentId);
          opts.bm25.removeByDocumentId(entry.documentId);
          opts.manifest.delete(path);
          await opts.manifest.save();
          await opts.bm25.save(opts.bm25File);
        }
      } else {
        await ingestPaths([path], opts);
      }
    }, debounce));
  };

  watcher.on('add', (p) => schedule('add', p));
  watcher.on('change', (p) => schedule('change', p));
  watcher.on('unlink', (p) => schedule('unlink', p));

  return { close: () => watcher.close() };
}
