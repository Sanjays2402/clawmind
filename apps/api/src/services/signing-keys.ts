import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  createHash,
  type KeyObject,
} from 'node:crypto';

// Workspace signing key (Ed25519).
//
// Procurement reviewers regularly ask "how can a third party verify
// that an artefact (warrant canary attestation, erasure certificate,
// DPA receipt) was actually issued by your service, without us
// trusting your server at request time?". The honest answer is:
// expose a public key, sign the artefacts you publish, and let
// auditors verify offline with stock crypto.
//
// We use Ed25519 (RFC 8032) because:
//   - 32-byte keys, 64-byte signatures: small enough to embed in
//     attestation payloads without bloating the public projection.
//   - Deterministic signatures (no nonce reuse footguns).
//   - Supported by every JWKS-aware library and by `openssl pkeyutl`
//     on stock distros, so a procurement reviewer can verify with
//     tools they already trust.
//
// The keypair is generated on first use and persisted under the data
// directory. The private key file is chmod 0600. Rotating the key is
// out of scope for this revision; the JWKS surface is designed so
// that a future rotation can publish multiple `keys[]` entries with
// distinct `kid` values without breaking existing verifiers.

export interface SigningKeyMaterial {
  /** Stable key id derived from the public key (SHA-256 truncated, base64url). */
  kid: string;
  /** Ed25519 algorithm identifier per RFC 8037. */
  alg: 'EdDSA';
  /** OKP key type per RFC 8037. */
  kty: 'OKP';
  crv: 'Ed25519';
  /** Base64url-encoded raw 32-byte public key (RFC 8037 `x` parameter). */
  x: string;
  /** PEM-encoded SPKI public key for openssl-based verifiers. */
  publicPem: string;
  /** Created-at epoch millis. */
  createdAt: number;
}

interface OnDiskKey {
  createdAt: number;
  privatePem: string;
  publicPem: string;
}

const PRIVATE_FILE = 'signing/workspace-ed25519.pem';
const PUBLIC_FILE = 'signing/workspace-ed25519.pub.pem';
const META_FILE = 'signing/workspace-ed25519.json';

function privatePath(dataDir: string): string {
  return join(dataDir, PRIVATE_FILE);
}
function publicPath(dataDir: string): string {
  return join(dataDir, PUBLIC_FILE);
}
function metaPath(dataDir: string): string {
  return join(dataDir, META_FILE);
}

function deriveKid(publicKey: KeyObject): string {
  // RFC 7638-style thumbprint, simplified for OKP/Ed25519: SHA-256
  // over the JSON canonical form of {crv,kty,x}. Truncated to 16
  // bytes for a compact, copy-pastable kid; collisions are not a
  // security boundary because the full `x` parameter is published
  // alongside the kid in the JWKS.
  const raw = publicKey.export({ format: 'jwk' }) as { x: string };
  const jwk = JSON.stringify({ crv: 'Ed25519', kty: 'OKP', x: raw.x });
  const hash = createHash('sha256').update(jwk).digest();
  return hash.subarray(0, 16).toString('base64url');
}

async function loadFromDisk(dataDir: string): Promise<OnDiskKey | null> {
  try {
    const [priv, pub, metaRaw] = await Promise.all([
      readFile(privatePath(dataDir), 'utf8'),
      readFile(publicPath(dataDir), 'utf8'),
      readFile(metaPath(dataDir), 'utf8'),
    ]);
    const meta = JSON.parse(metaRaw) as { createdAt?: number };
    return {
      privatePem: priv,
      publicPem: pub,
      createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : Date.now(),
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function generateAndPersist(dataDir: string): Promise<OnDiskKey> {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const publicPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const createdAt = Date.now();
  const meta = { createdAt };

  await mkdir(dirname(privatePath(dataDir)), { recursive: true });
  // Order matters: write the private file first with 0600, then the
  // public artefacts. A crash mid-write leaves the on-disk state
  // consistent for the next loadFromDisk() probe (which requires all
  // three files to be present).
  await writeFile(privatePath(dataDir), privatePem, { encoding: 'utf8', mode: 0o600 });
  await chmod(privatePath(dataDir), 0o600).catch(() => {});
  await writeFile(publicPath(dataDir), publicPem, 'utf8');
  await writeFile(metaPath(dataDir), JSON.stringify(meta, null, 2) + '\n', 'utf8');
  return { privatePem, publicPem, createdAt };
}

// Module-level cache: the keypair is immutable for the lifetime of
// the process (no rotation surface yet), so re-reading from disk on
// every signature is pointless overhead. Key is dataDir so test
// suites that spin up multiple temp dirs do not collide.
const cache = new Map<string, OnDiskKey>();

async function ensureKey(dataDir: string): Promise<OnDiskKey> {
  const hit = cache.get(dataDir);
  if (hit) return hit;
  const loaded = (await loadFromDisk(dataDir)) ?? (await generateAndPersist(dataDir));
  cache.set(dataDir, loaded);
  return loaded;
}

export async function getPublicMaterial(dataDir: string): Promise<SigningKeyMaterial> {
  const key = await ensureKey(dataDir);
  const publicKey = createPublicKey(key.publicPem);
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  return {
    kid: deriveKid(publicKey),
    alg: 'EdDSA',
    kty: 'OKP',
    crv: 'Ed25519',
    x: jwk.x,
    publicPem: key.publicPem,
    createdAt: key.createdAt,
  };
}

/**
 * Returns the same shape RFC 7517 defines for a JWK Set. Procurement
 * reviewers and audit pipelines consume `keys[]` directly; we keep
 * the array shape even for a single key so a future rotation does
 * not require a breaking change.
 */
export async function getJwks(dataDir: string): Promise<{ keys: Array<Record<string, string>> }> {
  const mat = await getPublicMaterial(dataDir);
  return {
    keys: [
      {
        kid: mat.kid,
        kty: mat.kty,
        crv: mat.crv,
        alg: mat.alg,
        x: mat.x,
        use: 'sig',
      },
    ],
  };
}

export interface SignedPayload {
  /** Hex-encoded SHA-256 of the canonical payload bytes. */
  digest: string;
  /** Base64url Ed25519 signature over the canonical payload bytes. */
  signature: string;
  /** kid of the key that produced `signature`. */
  kid: string;
  /** EdDSA, per RFC 8037 §3.1. */
  alg: 'EdDSA';
}

/**
 * Sign a UTF-8 string with the workspace Ed25519 key. The caller is
 * responsible for producing a canonical, stable serialisation of the
 * artefact being signed; we deliberately do not sign JS objects to
 * keep verification reproducible across languages.
 */
export async function signPayload(dataDir: string, canonical: string): Promise<SignedPayload> {
  const key = await ensureKey(dataDir);
  const priv = createPrivateKey(key.privatePem);
  const bytes = Buffer.from(canonical, 'utf8');
  // Ed25519 in Node uses crypto.sign(null, data, key); the algorithm
  // is implied by the key type, and passing a digest name here
  // throws.
  const sig = cryptoSign(null, bytes, priv);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const publicKey = createPublicKey(key.publicPem);
  return {
    digest,
    signature: sig.toString('base64url'),
    kid: deriveKid(publicKey),
    alg: 'EdDSA',
  };
}

/**
 * Verify a signature produced by signPayload against the current
 * workspace key. Returns true iff the signature is valid AND the kid
 * matches; we never silently accept a foreign kid because that would
 * defeat the whole point of publishing a stable JWKS.
 */
export async function verifyPayload(
  dataDir: string,
  canonical: string,
  sig: { signature: string; kid: string },
): Promise<boolean> {
  const mat = await getPublicMaterial(dataDir);
  if (sig.kid !== mat.kid) return false;
  const publicKey = createPublicKey(mat.publicPem);
  try {
    return cryptoVerify(
      null,
      Buffer.from(canonical, 'utf8'),
      publicKey,
      Buffer.from(sig.signature, 'base64url'),
    );
  } catch {
    return false;
  }
}

/** Test-only: drop the in-process cache so a new dataDir is picked up. */
export function __resetCacheForTests(): void {
  cache.clear();
}
