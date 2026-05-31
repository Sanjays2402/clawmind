import { appendFile, mkdir, readFile, stat, rename, unlink, readdir } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { AuditEvent } from '@clawmind/types';

// Seed value committed to by the first record in any audit chain. Picking a
// fixed sentinel (rather than the empty string or all-zeroes) means a chain
// that genuinely starts here is distinguishable from one whose first record
// was deleted (the new "first" record would carry the deleted record's hash
// in prevHash, not GENESIS_PREV_HASH).
export const GENESIS_PREV_HASH = 'genesis';

// Stable serialisation for the hashable view of a record. We must exclude
// `hash` itself (we are computing it) and must include every other field in
// a deterministic order so a verifier on another machine gets the same
// digest. JSON.stringify with a fixed key list is enough: AuditEvent has a
// closed schema and `meta` is hashed by its own canonical serialisation.
function canonicalMeta(meta: unknown): string {
  if (meta === undefined || meta === null) return 'null';
  if (Array.isArray(meta)) return JSON.stringify(meta);
  if (typeof meta !== 'object') return JSON.stringify(meta);
  const obj = meta as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ':' + canonicalMeta(obj[k]));
  return '{' + parts.join(',') + '}';
}

function hashableBody(ev: AuditEvent): string {
  // Order matters; pin it explicitly.
  return JSON.stringify({
    id: ev.id,
    ts: ev.ts,
    actor: ev.actor,
    action: ev.action,
    resource: ev.resource,
    meta: ev.meta === undefined ? null : JSON.parse(canonicalMeta(ev.meta)),
    prevHash: ev.prevHash ?? GENESIS_PREV_HASH,
  });
}

export function computeRecordHash(ev: AuditEvent): string {
  return createHash('sha256').update(hashableBody(ev)).digest('hex');
}

export interface AuditVerifyResult {
  ok: boolean;
  checked: number;
  /** Index of the first bad record in chronological order, or null if ok. */
  firstBadIndex: number | null;
  /** Why the chain broke. Populated when ok=false. */
  reason: string | null;
  /** Hash of the most recent record. Useful for external anchoring. */
  headHash: string | null;
}

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
  /**
   * Optional listener invoked after every successful append. Used to
   * forward audit events to external sinks (SIEM webhooks, log shippers)
   * without coupling the on-disk hash chain to the network. Listener
   * failures are swallowed so a flaky sink can never break the audit
   * write itself, which is the source of truth.
   */
  onWrite?: (event: AuditEvent) => void | Promise<void>;
}

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 100;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_KEEP_FILES = 5;

export class AuditLog {
  private readonly maxBytes: number;
  private readonly keepFiles: number;
  private readonly onWrite?: (event: AuditEvent) => void | Promise<void>;
  // Cached hash of the last record written, used to seed the next record's
  // prevHash without re-reading the file. Lazily populated on first write.
  private lastHash: string | null = null;
  private lastHashLoaded = false;

  constructor(private readonly file: string, opts: AuditLogOptions = {}) {
    this.maxBytes = Math.max(opts.maxBytes ?? DEFAULT_MAX_BYTES, 0);
    this.keepFiles = Math.max(opts.keepFiles ?? DEFAULT_KEEP_FILES, 0);
    this.onWrite = opts.onWrite;
  }

  /**
   * Append a single event as JSON Lines. Returns the persisted record,
   * including the hash-chain fields (`prevHash`, `hash`). The chain is
   * seeded from the existing log on first write so a restart does not
   * silently start a fresh chain that would look broken to verify().
   */
  async write(event: Omit<AuditEvent, 'id' | 'ts' | 'prevHash' | 'hash'>): Promise<AuditEvent> {
    await mkdir(dirname(this.file), { recursive: true });
    // Rotate BEFORE appending so the new entry always lands in a file that
    // is at or below the configured limit. Rotation is cheap (rename) and
    // any I/O error here is bubbled up so an operator can investigate
    // rather than silently corrupting the on-disk audit trail.
    await this.maybeRotate();
    if (!this.lastHashLoaded) {
      this.lastHash = await this.readLastHash();
      this.lastHashLoaded = true;
    }
    const base: AuditEvent = {
      id: randomUUID(),
      ts: Date.now(),
      ...event,
      prevHash: this.lastHash ?? GENESIS_PREV_HASH,
    };
    const hash = computeRecordHash(base);
    const full: AuditEvent = { ...base, hash };
    await appendFile(this.file, JSON.stringify(full) + '\n', 'utf8');
    this.lastHash = hash;
    if (this.onWrite) {
      try {
        const r = this.onWrite(full);
        if (r && typeof (r as Promise<void>).then === 'function') {
          void (r as Promise<void>).catch(() => undefined);
        }
      } catch {
        // Listener errors must never corrupt or block the audit chain.
      }
    }
    return full;
  }

  /**
   * Walk every file in chronological order and verify each record's hash
   * and prevHash linkage. Returns the first inconsistency rather than
   * throwing so the audit API can surface a structured result.
   */
  async verify(): Promise<AuditVerifyResult> {
    const files = (await this.listFiles()).slice().reverse(); // oldest first
    let prev: string = GENESIS_PREV_HASH;
    let checked = 0;
    let head: string | null = null;
    for (const f of files) {
      const exists = await stat(f).then(() => true).catch(() => false);
      if (!exists) continue;
      const raw = await readFile(f, 'utf8');
      const lines = raw.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        let ev: AuditEvent;
        try {
          ev = JSON.parse(line) as AuditEvent;
        } catch {
          return {
            ok: false,
            checked,
            firstBadIndex: checked,
            reason: `malformed JSON in ${basename(f)} line ${i + 1}`,
            headHash: head,
          };
        }
        // Records written before the hash-chain upgrade have no hash and
        // no prevHash. Treat them as a legacy prefix: they neither extend
        // nor invalidate the chain, and the next chained record will use
        // GENESIS_PREV_HASH so verify() picks up from there.
        if (!ev.hash) {
          checked++;
          continue;
        }
        const expectedPrev = ev.prevHash ?? GENESIS_PREV_HASH;
        if (expectedPrev !== prev) {
          return {
            ok: false,
            checked,
            firstBadIndex: checked,
            reason: `prevHash mismatch at ${basename(f)} line ${i + 1}: expected ${prev}, got ${expectedPrev}`,
            headHash: head,
          };
        }
        const recomputed = computeRecordHash({ ...ev, hash: undefined });
        if (recomputed !== ev.hash) {
          return {
            ok: false,
            checked,
            firstBadIndex: checked,
            reason: `hash mismatch at ${basename(f)} line ${i + 1}`,
            headHash: head,
          };
        }
        prev = ev.hash;
        head = ev.hash;
        checked++;
      }
    }
    return { ok: true, checked, firstBadIndex: null, reason: null, headHash: head };
  }

  /**
   * Return the chained `hash` of the Nth chained record (1-indexed) across
   * every rotated sibling, in append order. Returns null if N is out of
   * range or no chained record exists at that position. Used by the anchor
   * store to confirm a past head still lives at the same position in the
   * live chain (rewrite detection).
   */
  async hashAt(n: number): Promise<string | null> {
    if (!Number.isInteger(n) || n < 1) return null;
    const files = (await this.listFiles()).slice().reverse(); // oldest first
    let seen = 0;
    for (const f of files) {
      const exists = await stat(f).then(() => true).catch(() => false);
      if (!exists) continue;
      const raw = await readFile(f, 'utf8');
      for (const line of raw.split('\n')) {
        if (!line) continue;
        let ev: AuditEvent;
        try {
          ev = JSON.parse(line) as AuditEvent;
        } catch {
          continue;
        }
        if (!ev.hash) {
          // Legacy pre-chain record: counted by verify() too.
          seen++;
          if (seen === n) return null;
          continue;
        }
        seen++;
        if (seen === n) return ev.hash;
      }
    }
    return null;
  }

  /**
   * Recover the last hash in the chain by scanning the newest file with
   * content. After rotation the active file is empty so we fall through to
   * `audit.log.1` and so on. Returns null if no chained record exists yet.
   */
  private async readLastHash(): Promise<string | null> {
    const files = await this.listFiles(); // newest first
    for (const f of files) {
      const exists = await stat(f).then(() => true).catch(() => false);
      if (!exists) continue;
      const raw = await readFile(f, 'utf8');
      const lines = raw.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line) continue;
        try {
          const ev = JSON.parse(line) as AuditEvent;
          if (ev.hash) return ev.hash;
        } catch {
          // Skip malformed tail lines; a partial write should not break the next append.
          continue;
        }
      }
    }
    return null;
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
    // After rotation the active file is empty; the chain head still lives
    // in the rotated sibling. Force lastHash to be re-read on next write so
    // the new file's first record links to the rotated file's tail.
    this.lastHashLoaded = false;
    this.lastHash = null;
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
   * Stream every audit event matching the supplied filters, oldest first
   * (the order events were written, across rotated siblings). Use this for
   * exports and any compliance pull that can exceed the 1000-row query cap:
   * the generator never builds the full set in memory, it parses each file
   * line by line and yields matches one at a time.
   *
   * Filters mirror AuditQuery (actor exact, action substring, resource
   * prefix, since inclusive, until exclusive). `limit` and `offset` from
   * AuditQuery are intentionally ignored here; the consumer decides how
   * much to read.
   */
  async *iterate(q: AuditQuery = {}): AsyncGenerator<AuditEvent, void, void> {
    // listFiles returns active first, then .1, .2, ... (newest-first by
    // rotation). Reverse so we yield oldest events first, which matches
    // how an external auditor expects a JSONL feed to read.
    const files = (await this.listFiles()).slice().reverse();
    for (const f of files) {
      const exists = await stat(f).then(() => true).catch(() => false);
      if (!exists) continue;
      // For very large logs we still read whole files; the per-event yield
      // keeps response memory bounded even when the caller is slow.
      const raw = await readFile(f, 'utf8');
      const lines = raw.split('\n');
      for (const line of lines) {
        if (!line) continue;
        let ev: AuditEvent;
        try {
          ev = JSON.parse(line) as AuditEvent;
        } catch {
          // Skip malformed tail lines, same as query().
          continue;
        }
        if (q.actor && ev.actor !== q.actor) continue;
        if (q.action && !ev.action.includes(q.action)) continue;
        if (q.resource && !ev.resource.startsWith(q.resource)) continue;
        if (q.since !== undefined && ev.ts < q.since) continue;
        if (q.until !== undefined && ev.ts >= q.until) continue;
        yield ev;
      }
    }
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
