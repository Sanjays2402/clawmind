import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
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

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 100;

export class AuditLog {
  constructor(private readonly file: string) {}

  /** Append a single event as JSON Lines. Returns the persisted record. */
  async write(event: Omit<AuditEvent, 'id' | 'ts'>): Promise<AuditEvent> {
    const full: AuditEvent = { id: randomUUID(), ts: Date.now(), ...event };
    await mkdir(dirname(this.file), { recursive: true });
    await appendFile(this.file, JSON.stringify(full) + '\n', 'utf8');
    return full;
  }

  /**
   * Read and filter the JSONL audit log. Designed for compliance review
   * rather than analytics, so we read the whole file, filter in memory,
   * and cap the response. For very large logs the file should be rotated
   * by external tooling (logrotate, k8s sidecar) and this method should
   * be replaced by a streaming reader.
   */
  async query(q: AuditQuery = {}): Promise<AuditQueryResult> {
    const exists = await stat(this.file).then(() => true).catch(() => false);
    if (!exists) return { total: 0, events: [] };

    const raw = await readFile(this.file, 'utf8');
    const lines = raw.split('\n');
    const all: AuditEvent[] = [];
    for (const line of lines) {
      if (!line) continue;
      try {
        all.push(JSON.parse(line) as AuditEvent);
      } catch {
        // Skip malformed lines rather than failing the entire query.
        // A bad line should never lock an operator out of their audit trail.
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
}
