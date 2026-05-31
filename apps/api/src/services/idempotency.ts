import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

// Idempotency keys
//
// Lets callers safely retry mutating requests (POST/PUT/PATCH/DELETE) without
// risking double-creates or duplicate side-effects when a network blip
// triggers a client retry. Modelled on the Stripe / Square pattern:
//
//   * Client picks a unique key per logical request (UUID, ULID, etc.) and
//     sends it in the `Idempotency-Key` header.
//   * Server stores the response (status + headers we care about + body) the
//     first time, keyed by (actor, method, path, key, body-hash).
//   * Subsequent retries with the same key+body replay the stored response
//     byte-for-byte and add `Idempotency-Replay: true`.
//   * A retry with the same key but a different body returns 409 so the
//     client immediately sees the conflict instead of silently mutating
//     state under a reused key.
//
// We deliberately scope keys by actor (user id or API-key id) so two
// independent tenants reusing the same key string never collide.
//
// Storage: on-disk JSON at <dataDir>/idempotency.json, atomic-rewrite,
// matches the rest of the codebase (sessions.json, api-keys.json, etc.).
// Entries expire after IDEMPOTENCY_TTL_MS; expired rows are dropped on the
// next write so the file does not grow unbounded.

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_KEY_LEN = 200;
export const MIN_KEY_LEN = 8;
export const MAX_ENTRIES = 10_000;
// Capture only safe replay headers; ignore noisy per-request ones like
// x-request-id or rate-limit counters that would lie on a replay.
const CAPTURED_HEADERS = new Set([
  'content-type',
  'location',
  'idempotency-key',
]);
// RFC-ish: key must look like an opaque token, no spaces or control chars.
// Same character class as the request-id plugin to keep audit logs sane.
const KEY_RE = /^[A-Za-z0-9_.:-]+$/;

export interface IdempotencyRecord {
  actor: string;
  method: string;
  path: string;
  key: string;
  // Hex sha256 of the request body. A retry with the same key but a
  // different body is a 409, not a silent replay.
  bodyHash: string;
  status: number;
  headers: Record<string, string>;
  // base64 of the raw response body so we replay bytes, not a re-serialised
  // shape that might differ between deploys.
  bodyB64: string;
  createdAt: number;
}

interface RegistryFile {
  version: 1;
  entries: IdempotencyRecord[];
}

export function isValidKey(raw: string): boolean {
  if (typeof raw !== 'string') return false;
  if (raw.length < MIN_KEY_LEN || raw.length > MAX_KEY_LEN) return false;
  return KEY_RE.test(raw);
}

export function hashBody(body: Buffer | string | undefined | null): string {
  const buf = body == null
    ? Buffer.alloc(0)
    : Buffer.isBuffer(body)
      ? body
      : Buffer.from(body, 'utf8');
  return createHash('sha256').update(buf).digest('hex');
}

function file(dataDir: string): string {
  return join(dataDir, 'idempotency.json');
}

async function readFileOrEmpty(path: string): Promise<RegistryFile> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as RegistryFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return { version: 1, entries: [] };
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, entries: [] };
    }
    throw err;
  }
}

async function writeAtomic(path: string, data: RegistryFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(data), 'utf8');
  await rename(tmp, path);
}

function pruneAndCap(entries: IdempotencyRecord[], now: number): IdempotencyRecord[] {
  const live = entries.filter((e) => now - e.createdAt < IDEMPOTENCY_TTL_MS);
  if (live.length <= MAX_ENTRIES) return live;
  // Evict oldest first when over the cap; deterministic and cheap.
  live.sort((a, b) => a.createdAt - b.createdAt);
  return live.slice(live.length - MAX_ENTRIES);
}

export type LookupResult =
  | { kind: 'miss' }
  | { kind: 'replay'; record: IdempotencyRecord }
  | { kind: 'conflict'; existingBodyHash: string };

export async function lookup(
  dataDir: string,
  actor: string,
  method: string,
  path: string,
  key: string,
  bodyHash: string,
  now: number = Date.now(),
): Promise<LookupResult> {
  const reg = await readFileOrEmpty(file(dataDir));
  const match = reg.entries.find(
    (e) =>
      e.actor === actor &&
      e.method === method &&
      e.path === path &&
      e.key === key &&
      now - e.createdAt < IDEMPOTENCY_TTL_MS,
  );
  if (!match) return { kind: 'miss' };
  if (match.bodyHash !== bodyHash) {
    return { kind: 'conflict', existingBodyHash: match.bodyHash };
  }
  return { kind: 'replay', record: match };
}

export async function record(
  dataDir: string,
  rec: IdempotencyRecord,
): Promise<void> {
  const path = file(dataDir);
  const reg = await readFileOrEmpty(path);
  // If a concurrent write beat us to it with the same key + body, keep the
  // earliest one so retries always see the same answer.
  const duplicate = reg.entries.find(
    (e) =>
      e.actor === rec.actor &&
      e.method === rec.method &&
      e.path === rec.path &&
      e.key === rec.key,
  );
  if (duplicate && duplicate.bodyHash === rec.bodyHash) return;
  if (duplicate) {
    // Different body for the same key: keep the first, never overwrite.
    return;
  }
  reg.entries.push(rec);
  reg.entries = pruneAndCap(reg.entries, Date.now());
  await writeAtomic(path, reg);
}

export function captureHeaders(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!CAPTURED_HEADERS.has(k.toLowerCase())) continue;
    if (typeof v === 'string') out[k.toLowerCase()] = v;
    else if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'string') out[k.toLowerCase()] = v[0] as string;
  }
  return out;
}

// Exposed for tests.
export async function _resetForTest(dataDir: string): Promise<void> {
  await writeAtomic(file(dataDir), { version: 1, entries: [] });
}
