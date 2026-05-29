import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface ManifestEntry {
  path: string;
  hash: string;
  mtime: number;
  size: number;
  documentId: string;
  chunkCount: number;
  ingestedAt: number;
}

export class IngestManifest {
  private map = new Map<string, ManifestEntry>();
  constructor(private readonly file: string) {}

  async load() {
    try {
      const raw = await readFile(this.file, 'utf8');
      const list = JSON.parse(raw) as ManifestEntry[];
      this.map = new Map(list.map((e) => [e.path, e]));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async save() {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify([...this.map.values()], null, 2), 'utf8');
  }

  get(path: string) { return this.map.get(path); }
  set(entry: ManifestEntry) { this.map.set(entry.path, entry); }
  delete(path: string) { this.map.delete(path); }
  entries() { return [...this.map.values()]; }
  size() { return this.map.size; }

  needsReindex(path: string, hash: string, mtime: number): boolean {
    const cur = this.map.get(path);
    if (!cur) return true;
    return cur.hash !== hash || cur.mtime !== mtime;
  }
}
