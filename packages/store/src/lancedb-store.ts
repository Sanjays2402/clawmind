import { mkdir } from 'node:fs/promises';
import { connect } from '@lancedb/lancedb';
import type { Chunk, RetrievedChunk } from '@clawmind/types';
import { CHUNK_TABLE } from './schema.js';

export interface LanceStoreOptions {
  dir: string;
  dim: number;
}

export class LanceStore {
  private conn: Awaited<ReturnType<typeof connect>> | null = null;
  constructor(private readonly opts: LanceStoreOptions) {}

  async init() {
    await mkdir(this.opts.dir, { recursive: true });
    this.conn = await connect(this.opts.dir);
  }

  private connOrThrow() {
    if (!this.conn) throw new Error('LanceStore not initialized; call init() first');
    return this.conn;
  }

  async ensureTable() {
    const c = this.connOrThrow();
    const names = await c.tableNames();
    if (names.includes(CHUNK_TABLE)) return c.openTable(CHUNK_TABLE);
    const seed = [
      {
        id: '__seed__',
        documentId: '__seed__',
        path: '',
        namespace: 'misc',
        text: '',
        startLine: 0,
        endLine: 0,
        tokens: 0,
        ord: 0,
        embedding: new Array(this.opts.dim).fill(0),
      },
    ];
    const table = await c.createTable(CHUNK_TABLE, seed);
    await table.delete("id = '__seed__'");
    return table;
  }

  async upsert(chunks: Chunk[]) {
    if (chunks.length === 0) return;
    const table = await this.ensureTable();
    const ids = chunks.map((c) => `'${c.id.replace(/'/g, "''")}'`).join(',');
    await table.delete(`id IN (${ids})`);
    await table.add(
      chunks.map((c) => ({
        id: c.id,
        documentId: c.documentId,
        path: c.path,
        namespace: c.namespace,
        text: c.text,
        startLine: c.startLine,
        endLine: c.endLine,
        tokens: c.tokens,
        ord: c.ord,
        embedding: c.embedding ?? new Array(this.opts.dim).fill(0),
      })),
    );
  }

  async deleteByDocument(documentId: string) {
    const table = await this.ensureTable();
    await table.delete(`documentId = '${documentId.replace(/'/g, "''")}'`);
  }

  async search(vec: number[], k: number, namespaces?: string[]): Promise<RetrievedChunk[]> {
    const table = await this.ensureTable();
    let q = table.search(vec).limit(k);
    if (namespaces && namespaces.length > 0) {
      const filter = namespaces.map((n) => `namespace = '${n}'`).join(' OR ');
      q = q.where(filter);
    }
    const rows = (await q.toArray()) as Array<Chunk & { _distance: number }>;
    return rows.map((r) => ({
      ...(r as Chunk),
      score: 1 - r._distance,
      denseScore: 1 - r._distance,
    }));
  }

  async count(): Promise<number> {
    const table = await this.ensureTable();
    return await table.countRows();
  }

  async close() {
    this.conn = null;
  }
}
