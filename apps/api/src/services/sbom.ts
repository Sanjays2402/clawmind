import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// Software Bill of Materials (CycloneDX 1.5).
//
// US Executive Order 14028 (Improving the Nation's Cybersecurity) and
// the matching ENISA / EU CRA guidance now make an SBOM a baseline
// procurement deliverable for any software a federal customer or
// regulated enterprise buys. The buyer's vulnerability-management team
// drops the document into their own SCA tool (Anchore, Snyk, Dependency-
// Track) and reconciles it against CISA's KEV catalog. Without a stable
// URL the questionnaire stalls.
//
// We generate the SBOM at request time from the on-disk package.json
// files in the monorepo (root + apps/* + packages/*) so it cannot drift
// from what actually runs. The owner can layer an attestation overlay
// on top that records the vendor identity, source repository, build
// commit, and a signed-by reviewer, which is what auditors actually
// pin in their record. The component graph itself is not editable from
// the network: a malicious admin cannot quietly remove a vulnerable
// component from the published SBOM.

export type ComponentScope = 'required' | 'optional';

export interface SbomComponent {
  bomRef: string;
  name: string;
  version: string;
  type: 'library' | 'application';
  scope: ComponentScope;
  purl: string;
  consumers: string[];
}

export interface SbomSignature {
  hash: string;
  signedBy: string;
  signedAt: number;
  componentCount: number;
}

export interface SbomAttestation {
  vendor: string;
  repository: string;
  commit: string;
  notes: string;
  signature: SbomSignature | null;
  updatedAt: number;
  updatedBy: string | null;
}

export class SbomValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SbomValidationError';
  }
}

export const SBOM_LIMITS = Object.freeze({
  vendor: 256,
  repository: 1024,
  commit: 256,
  notes: 8000,
});

function fail(msg: string): never {
  throw new SbomValidationError(msg);
}

function emptyAttestation(now: number): SbomAttestation {
  return {
    vendor: '',
    repository: '',
    commit: '',
    notes: '',
    signature: null,
    updatedAt: now,
    updatedBy: null,
  };
}

function attestationPath(dir: string): string {
  return join(dir, 'sbom-attestation.json');
}

export async function getAttestation(dir: string): Promise<SbomAttestation> {
  try {
    const raw = await readFile(attestationPath(dir), 'utf8');
    const parsed = JSON.parse(raw) as SbomAttestation;
    return {
      vendor: typeof parsed.vendor === 'string' ? parsed.vendor : '',
      repository: typeof parsed.repository === 'string' ? parsed.repository : '',
      commit: typeof parsed.commit === 'string' ? parsed.commit : '',
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      signature: parsed.signature ?? null,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      updatedBy: parsed.updatedBy ?? null,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyAttestation(Date.now());
    throw err;
  }
}

async function writeAttestation(dir: string, doc: SbomAttestation): Promise<void> {
  const p = attestationPath(dir);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(doc, null, 2), 'utf8');
}

export interface AttestationUpdate {
  vendor?: string;
  repository?: string;
  commit?: string;
  notes?: string;
}

function trim(v: string): string {
  return v.replace(/\s+/g, ' ').trim();
}

export async function updateAttestation(
  dir: string,
  userId: string,
  input: AttestationUpdate,
): Promise<SbomAttestation> {
  if (!userId) fail('userId is required');
  const cur = await getAttestation(dir);
  const next: SbomAttestation = {
    ...cur,
    vendor: input.vendor !== undefined ? trim(input.vendor) : cur.vendor,
    repository: input.repository !== undefined ? trim(input.repository) : cur.repository,
    commit: input.commit !== undefined ? trim(input.commit) : cur.commit,
    notes: input.notes !== undefined ? input.notes : cur.notes,
    updatedAt: Date.now(),
    updatedBy: userId,
  };
  if (next.vendor.length > SBOM_LIMITS.vendor) fail('vendor exceeds limit');
  if (next.repository.length > SBOM_LIMITS.repository) fail('repository exceeds limit');
  if (next.commit.length > SBOM_LIMITS.commit) fail('commit exceeds limit');
  if (next.notes.length > SBOM_LIMITS.notes) fail('notes exceed limit');
  if (next.repository && !/^https?:\/\//i.test(next.repository)) {
    fail('repository must be an http(s) URL');
  }
  // Changing the underlying metadata invalidates any prior signature
  // over a document that included those fields; clear it so a buyer
  // never sees a stale signed-by alongside fresh content.
  next.signature = null;
  await writeAttestation(dir, next);
  return next;
}

interface PackageManifest {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function readPackageManifest(path: string): Promise<PackageManifest | null> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as PackageManifest;
  } catch {
    return null;
  }
}

function bomRefFor(name: string, version: string): string {
  return `pkg:${name}@${version}`;
}

function buildPurl(name: string, version: string): string {
  const v = encodeURIComponent(version);
  if (name.startsWith('@')) {
    const [scope, pkg] = name.split('/');
    if (!scope || !pkg) return `pkg:npm/${encodeURIComponent(name)}@${v}`;
    return `pkg:npm/${encodeURIComponent(scope)}/${encodeURIComponent(pkg)}@${v}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${v}`;
}

export async function collectComponents(repoRoot: string): Promise<SbomComponent[]> {
  const workspaceRoots = [join(repoRoot, 'apps'), join(repoRoot, 'packages')];
  const workspacePackages: { dir: string; manifest: PackageManifest }[] = [];
  const rootManifest = await readPackageManifest(join(repoRoot, 'package.json'));
  if (rootManifest) workspacePackages.push({ dir: repoRoot, manifest: rootManifest });
  for (const root of workspaceRoots) {
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      const dir = join(root, name);
      try {
        const s = await stat(dir);
        if (!s.isDirectory()) continue;
      } catch {
        continue;
      }
      const m = await readPackageManifest(join(dir, 'package.json'));
      if (m) workspacePackages.push({ dir, manifest: m });
    }
  }

  const byKey = new Map<string, SbomComponent>();
  function add(name: string, version: string, scope: ComponentScope, consumer: string): void {
    if (!name || !version) return;
    const isWorkspace = version.startsWith('workspace:');
    const key = `${isWorkspace ? 'workspace' : 'npm'}:${name}@${version}`;
    let cur = byKey.get(key);
    if (!cur) {
      cur = {
        bomRef: bomRefFor(name, version),
        name,
        version,
        type: isWorkspace ? 'application' : 'library',
        scope,
        purl: isWorkspace ? '' : buildPurl(name, version),
        consumers: [],
      };
      byKey.set(key, cur);
    }
    if (!cur.consumers.includes(consumer)) cur.consumers.push(consumer);
    if (cur.scope === 'optional' && scope === 'required') cur.scope = 'required';
  }

  for (const { manifest } of workspacePackages) {
    const consumer = manifest.name ?? 'unknown';
    const deps = manifest.dependencies ?? {};
    const devDeps = manifest.devDependencies ?? {};
    for (const [name, version] of Object.entries(deps)) add(name, version, 'required', consumer);
    for (const [name, version] of Object.entries(devDeps)) add(name, version, 'optional', consumer);
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (a.name === b.name) return a.version.localeCompare(b.version);
    return a.name.localeCompare(b.name);
  });
}

export interface SbomDocument {
  bomFormat: 'CycloneDX';
  specVersion: '1.5';
  serialNumber: string;
  version: 1;
  metadata: {
    timestamp: string;
    tools: { vendor: string; name: string; version: string }[];
    component: { type: 'application'; 'bom-ref': string; name: string; version: string };
    supplier?: { name: string; url?: string[] };
    properties: { name: string; value: string }[];
  };
  components: {
    type: 'library' | 'application';
    'bom-ref': string;
    name: string;
    version: string;
    scope: ComponentScope;
    purl?: string;
    properties: { name: string; value: string }[];
  }[];
}

export interface RenderInput {
  repoRoot: string;
  rootName: string;
  rootVersion: string;
  attestation: SbomAttestation;
  now: number;
}

export async function renderCycloneDx(input: RenderInput): Promise<SbomDocument> {
  const components = await collectComponents(input.repoRoot);
  const componentEntries = components.map((c) => ({
    type: c.type,
    'bom-ref': c.bomRef,
    name: c.name,
    version: c.version,
    scope: c.scope,
    ...(c.purl ? { purl: c.purl } : {}),
    properties: [{ name: 'clawmind:consumers', value: c.consumers.slice().sort().join(',') }],
  }));
  const tools = [{ vendor: 'clawmind', name: 'sbom-renderer', version: '1' }];
  const properties: { name: string; value: string }[] = [];
  if (input.attestation.commit) {
    properties.push({ name: 'clawmind:buildCommit', value: input.attestation.commit });
  }
  if (input.attestation.signature) {
    properties.push({
      name: 'clawmind:signedAt',
      value: new Date(input.attestation.signature.signedAt).toISOString(),
    });
    properties.push({ name: 'clawmind:signatureHash', value: input.attestation.signature.hash });
  }
  const canon = JSON.stringify({
    rootName: input.rootName,
    rootVersion: input.rootVersion,
    components: componentEntries,
  });
  const digest = createHash('sha256').update(canon).digest('hex');
  const serialNumber = `urn:uuid:${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber,
    version: 1,
    metadata: {
      timestamp: new Date(input.now).toISOString(),
      tools,
      component: {
        type: 'application',
        'bom-ref': bomRefFor(input.rootName, input.rootVersion),
        name: input.rootName,
        version: input.rootVersion,
      },
      ...(input.attestation.vendor
        ? {
            supplier: {
              name: input.attestation.vendor,
              ...(input.attestation.repository ? { url: [input.attestation.repository] } : {}),
            },
          }
        : {}),
      properties,
    },
    components: componentEntries,
  };
}

// Stable hash over the SBOM document excluding the volatile timestamp
// and signature-derived properties so signing is a fixed point.
export function canonicalHash(doc: SbomDocument): string {
  const clone = JSON.parse(JSON.stringify(doc)) as SbomDocument;
  clone.metadata.timestamp = '';
  clone.metadata.properties = clone.metadata.properties.filter(
    (p) => p.name !== 'clawmind:signedAt' && p.name !== 'clawmind:signatureHash',
  );
  return createHash('sha256').update(JSON.stringify(clone)).digest('hex');
}

export interface SignInput {
  dir: string;
  userId: string;
  doc: SbomDocument;
}

export async function signCurrent(input: SignInput): Promise<SbomAttestation> {
  if (!input.userId) fail('userId is required');
  const cur = await getAttestation(input.dir);
  const hash = canonicalHash(input.doc);
  const next: SbomAttestation = {
    ...cur,
    signature: {
      hash,
      signedBy: input.userId,
      signedAt: Date.now(),
      componentCount: input.doc.components.length,
    },
    updatedAt: Date.now(),
    updatedBy: input.userId,
  };
  await writeAttestation(input.dir, next);
  return next;
}

export interface PublicAttestation {
  vendor: string;
  repository: string;
  commit: string;
  notes: string;
  signature: SbomSignature | null;
}

export function publicAttestation(a: SbomAttestation): PublicAttestation {
  return {
    vendor: a.vendor,
    repository: a.repository,
    commit: a.commit,
    notes: a.notes,
    signature: a.signature,
  };
}

export function newSerial(): string {
  return `urn:uuid:${randomUUID()}`;
}

export async function resolveRepoRoot(startDir: string): Promise<string> {
  let cur = resolve(startDir);
  for (let i = 0; i < 8; i++) {
    const m = await readPackageManifest(join(cur, 'package.json'));
    if (m && (m as { workspaces?: unknown }).workspaces) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return resolve(startDir);
}
