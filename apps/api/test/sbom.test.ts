import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getAttestation,
  updateAttestation,
  signCurrent,
  renderCycloneDx,
  collectComponents,
  publicAttestation,
  canonicalHash,
  SbomValidationError,
} from '../src/services/sbom.js';

let dataDir: string;
let repoRoot: string;

function seedMonorepo(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'clawmind-test',
      version: '0.0.1',
      workspaces: ['apps/*', 'packages/*'],
      devDependencies: { vitest: '^2.0.0' },
    }),
  );
  mkdirSync(join(root, 'apps', 'api'), { recursive: true });
  writeFileSync(
    join(root, 'apps', 'api', 'package.json'),
    JSON.stringify({
      name: '@clawmind/api',
      version: '0.1.0',
      dependencies: { fastify: '^5.1.0', zod: '^3.23.8' },
      devDependencies: { tsx: '^4.0.0' },
    }),
  );
  mkdirSync(join(root, 'packages', 'store'), { recursive: true });
  writeFileSync(
    join(root, 'packages', 'store', 'package.json'),
    JSON.stringify({
      name: '@clawmind/store',
      version: '0.1.0',
      dependencies: { '@clawmind/types': 'workspace:*', nanoid: '^5.0.0' },
    }),
  );
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cm-sbom-data-'));
  repoRoot = mkdtempSync(join(tmpdir(), 'cm-sbom-repo-'));
  seedMonorepo(repoRoot);
  return () => {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  };
});

describe('sbom attestation overlay', () => {
  it('starts empty on a fresh install', async () => {
    const a = await getAttestation(dataDir);
    expect(a.vendor).toBe('');
    expect(a.signature).toBeNull();
    expect(a.updatedBy).toBeNull();
  });

  it('rejects a non-http repository URL', async () => {
    await expect(
      updateAttestation(dataDir, 'op', { repository: 'git@example.com:x.git' }),
    ).rejects.toThrow(SbomValidationError);
  });

  it('persists vendor, commit, notes and records updatedBy', async () => {
    const next = await updateAttestation(dataDir, 'owner1', {
      vendor: 'ClawMind, Inc.',
      repository: 'https://github.com/example/clawmind',
      commit: 'abc1234',
      notes: 'Released 2026 Q2.',
    });
    expect(next.vendor).toBe('ClawMind, Inc.');
    expect(next.commit).toBe('abc1234');
    expect(next.updatedBy).toBe('owner1');
    const round = await getAttestation(dataDir);
    expect(round.repository).toBe('https://github.com/example/clawmind');
  });

  it('rejects oversize notes', async () => {
    await expect(
      updateAttestation(dataDir, 'op', { notes: 'x'.repeat(9000) }),
    ).rejects.toThrow(SbomValidationError);
  });

  it('clears a prior signature when the overlay is edited', async () => {
    await updateAttestation(dataDir, 'op', { vendor: 'V1' });
    const doc = await renderCycloneDx({
      repoRoot,
      rootName: 'clawmind-test',
      rootVersion: '0.0.1',
      attestation: await getAttestation(dataDir),
      now: 1,
    });
    const signed = await signCurrent({ dir: dataDir, userId: 'op', doc });
    expect(signed.signature).not.toBeNull();
    const after = await updateAttestation(dataDir, 'op', { vendor: 'V2' });
    expect(after.signature).toBeNull();
  });
});

describe('sbom cyclonedx render', () => {
  it('emits CycloneDX 1.5 with workspace + npm components', async () => {
    const doc = await renderCycloneDx({
      repoRoot,
      rootName: 'clawmind-test',
      rootVersion: '0.0.1',
      attestation: await getAttestation(dataDir),
      now: 1700000000000,
    });
    expect(doc.bomFormat).toBe('CycloneDX');
    expect(doc.specVersion).toBe('1.5');
    expect(doc.serialNumber).toMatch(/^urn:uuid:/);
    const names = doc.components.map((c) => c.name);
    expect(names).toContain('fastify');
    expect(names).toContain('zod');
    expect(names).toContain('nanoid');
    expect(names).toContain('vitest');
    const wsDep = doc.components.find((c) => c.name === '@clawmind/types');
    expect(wsDep?.type).toBe('application');
    expect(wsDep?.purl).toBeUndefined();
    const fastify = doc.components.find((c) => c.name === 'fastify');
    expect(fastify?.purl).toMatch(/^pkg:npm\/fastify@/);
    expect(fastify?.scope).toBe('required');
    const vitest = doc.components.find((c) => c.name === 'vitest');
    expect(vitest?.scope).toBe('optional');
  });

  it('canonicalHash ignores timestamp and signature-derived properties', async () => {
    const attestation = await updateAttestation(dataDir, 'op', { vendor: 'V', commit: 'abc' });
    const a = await renderCycloneDx({
      repoRoot,
      rootName: 'clawmind-test',
      rootVersion: '0.0.1',
      attestation,
      now: 1,
    });
    const b = await renderCycloneDx({
      repoRoot,
      rootName: 'clawmind-test',
      rootVersion: '0.0.1',
      attestation,
      now: 999_999_999,
    });
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it('signing then re-rendering keeps the same canonical hash', async () => {
    await updateAttestation(dataDir, 'op', { vendor: 'V', commit: 'c' });
    const att1 = await getAttestation(dataDir);
    const doc1 = await renderCycloneDx({
      repoRoot,
      rootName: 'clawmind-test',
      rootVersion: '0.0.1',
      attestation: att1,
      now: 1,
    });
    const expectedHash = canonicalHash(doc1);
    const signed = await signCurrent({ dir: dataDir, userId: 'op', doc: doc1 });
    expect(signed.signature?.hash).toBe(expectedHash);
    expect(signed.signature?.componentCount).toBe(doc1.components.length);
    const doc2 = await renderCycloneDx({
      repoRoot,
      rootName: 'clawmind-test',
      rootVersion: '0.0.1',
      attestation: signed,
      now: 2,
    });
    expect(canonicalHash(doc2)).toBe(expectedHash);
  });

  it('publicAttestation strips updatedBy/updatedAt', async () => {
    const a = await updateAttestation(dataDir, 'op-secret-id', { vendor: 'V' });
    const pub = publicAttestation(a);
    expect(pub.vendor).toBe('V');
    expect((pub as unknown as Record<string, unknown>).updatedBy).toBeUndefined();
    expect((pub as unknown as Record<string, unknown>).updatedAt).toBeUndefined();
  });

  it('collectComponents returns stable order', async () => {
    const a = await collectComponents(repoRoot);
    const b = await collectComponents(repoRoot);
    expect(a.map((c) => c.name)).toEqual(b.map((c) => c.name));
    const sorted = [...a].sort((x, y) => x.name.localeCompare(y.name));
    expect(a.map((c) => c.name)).toEqual(sorted.map((c) => c.name));
  });
});
