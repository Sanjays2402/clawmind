import { appendFile, mkdir, readFile, stat, rename, unlink, readdir } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AuditEvent } from '@clawmind/types';

export interface AuditQuery {
  actor?: string;
  action?: string;
  resource?: string;
  /** inclusive lower bound, epoch ms */
  since?: number;
  /** exclusive upper bound, epoch ms */
  until?: number;
  /** max records returned, capped at 1000 */
  limit?: number;
  /** offset into the filtered list (after newest-first sort) */
  offset?: number;
}

export interface AuditQueryResult {
  total: number;
  events: AuditEvent[];
}

export interface AuditLogOptions {
  /**
   * Rotate the active log file once its size on disk exceeds this many bytes.
   * The current file is moved aside to `<name>.1`, older rotations shift up
   * (`.1` -> `.2`, etc.) and anything past `keepFiles` is deleted.
   * Set to 0 to disable rotation. Default 32 MiB.
   */
  maxBytes?: number;
  /**
   * How many rotated files to retain alongside the active log. Set to 0 to
   * keep none (active file rotates and the previous content is dropped).
   * Default 5.
   */
  keepFiles?: number;
}

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 100;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_KEEP_FILES = 5;

export class AuditLog {
  private readonly maxBytes: number;
  private readonly keepFiles: number;

  constructor(private readonly file: string, opts: AuditLogOptions = {}) {
    this.maxBytes = Math.max(opts.maxBytes ?? DEFAULT_MAX_BYTES, 0);
    this.keepFiles = Math.max(opts.keepFiles ?? DEFAULT_KEEP_FILES, 0);
  }

  /** Append a single event as JSON Lines. Returns the persisted record. */
  async write(event: Omit<AuditEvent, 'id' | 'ts'>): Promise<AuditEvent> {
    const full: AuditEvent = { id: randomUUID(), ts: Date.now(), ...event };
    await mkdir(dirname(this.file), { recursive: true });
    // Rotate BEFORE appending so the new entry always lands in a file that
    // is at or below the configured limit. Rotation is cheap (rename) and
    // any I/O error here is bubbled up so an operator can investigate
    // rather than silently corrupting the on-disk audit trail.
    await this.maybeRotate();
    await appendFile(this.file, JSON.stringify(full) + '\n', 'utf8');
    return full;
  }

  /**
   * If the active log file is past `maxBytes`, rename `audit.log` to
   * `audit.log.1`, shifting older rotations up by one. Anything past
   * `keepFiles` is unlinked.
   */
  async maybeRotate(): Promise<boolean> {
    if (this.maxBytes === 0) return false;
    const size = await stat(this.file).then((s) => s.size).catch(() => 0);
    if (size < this.maxBytes) return false;
    await this.rotateNow();
    return true;
  }

  /** Force rotation regardless of size. Useful for tests and ops scripts. */
  async rotateNow(): Promise<void> {
    const exists = await stat(this.file).then(() => true).catch(() => false);
    if (!exists) return;
    // Drop the oldest rotation that would get pushed past keepFiles by the
    // shift below. With keepFiles=N we want to end up with .1 .. .N, so we
    // unlink .N here, shift .N-1 -> .N, ..., .1 -> .2, then rename the
    // active file to .1.
    if (this.keepFiles >= 1) {
      const oldest = `${this.file}.${this.keepFiles}`;
      await unlink(oldest).catch(() => undefined);
    }
    // Shift .i -> .i+1 from the top down to avoid clobbering.
    for (let i = this.keepFiles - 1; i >= 1; i--) {
      const from = `${this.file}.${i}`;
      const to = `${this.file}.${i + 1}`;
      await rename(from, to).catch(() => undefined);
    }
    if (this.keepFiles === 0) {
      // No retention: drop the previous content entirely.
      await unlink(this.file).catch(() => undefined);
    } else {
      await rename(this.file, `${this.file}.1`).catch(() => undefined);
    }
  }

  /**
   * Read and filter the JSONL audit log, including rotated siblings so
   * compliance queries do not silently miss events that crossed a rotation
   * boundary. For very large logs this should be replaced by a streaming
   * reader; today the response is capped at 1000 events per call.
   */
  async query(q: AuditQuery = {}): Promise<AuditQueryResult> {
    const files = await this.listFiles();
    const all: AuditEvent[] = [];
    for (const f of files) {
      const exists = await stat(f).then(() => true).catch(() => false);
      if (!exists) continue;
      const raw = await readFile(f, 'utf8');
      for (const line of raw.split('\n')) {
        if (!line) continue;
        try {
          all.push(JSON.parse(line) as AuditEvent);
        } catch {
          // Skip malformed lines rather than failing the entire query.
          // A bad line should never lock an operator out of their audit trail.
        }
      }
    }

    const filtered = all.filter((e) => {
      if (q.actor && e.actor !== q.actor) return false;
      if (q.action && !e.action.includes(q.action)) return false;
      if (q.resource && !e.resource.startsWith(q.resource)) return false;
      if (q.since !== undefined && e.ts < q.since) return false;
      if (q.until !== undefined && e.ts >= q.until) return false;
      return true;
    });

    // Newest first so reviewers see the most recent activity by default.
    filtered.sort((a, b) => b.ts - a.ts);

    const limit = Math.min(Math.max(q.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(q.offset ?? 0, 0);
    return {
      total: filtered.length,
      events: filtered.slice(offset, offset + limit),
    };
  }

  /**
   * Enumerate the active log plus any sibling rotations (`audit.log.1`,
   * `audit.log.2`, ...). Returned in newest-first order so a bounded reader
   * can stop early. Exposed for tests and ops tooling.
   */
  async listFiles(): Promise<string[]> {
    const dir = dirname(this.file);
    const base = basename(this.file);
    const entries = await readdir(dir).catch(() => [] as string[]);
    const rotations: { path: string; n: number }[] = [];
    let hasActive = false;
    for (const name of entries) {
      if (name === base) {
        hasActive = true;
        continue;
      }
      if (!name.startsWith(`${base}.`)) continue;
      const tail = name.slice(base.length + 1);
      const n = Number(tail);
      if (!Number.isInteger(n) || n < 1) continue;
      rotations.push({ path: join(dir, name), n });
    }
    rotations.sort((a, b) => a.n - b.n);
    const out: string[] = [];
    if (hasActive) out.push(this.file);
    for (const r of rotations) out.push(r.path);
    return out;
  }
}
