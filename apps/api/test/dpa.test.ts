import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DPA_VERSIONS,
  currentVersion,
  listVersions,
  recordAcceptance,
  listAcceptances,
  currentAcceptance,
  verifySignature,
  validateAccept,
  DpaValidationError,
} from '../src/services/dpa.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-dpa-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('dpa shipped versions', () => {
  it('ships at least one version with a stable fingerprint', () => {
    expect(DPA_VERSIONS.length).toBeGreaterThan(0);
    for (const v of DPA_VERSIONS) {
      expect(v.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(v.body.length).toBeGreaterThan(200);
    }
    expect(currentVersion().id).toBe(DPA_VERSIONS[DPA_VERSIONS.length - 1]!.id);
    expect(listVersions().length).toBe(DPA_VERSIONS.length);
  });
});

describe('dpa acceptance validation', () => {
  it('rejects missing required fields', () => {
    expect(() =>
      validateAccept({
        signatoryName: '',
        signatoryTitle: 'CTO',
        signatoryEmail: 'cto@acme.example',
      } as any),
    ).toThrow(DpaValidationError);
    expect(() =>
      validateAccept({
        signatoryName: 'A',
        signatoryTitle: '',
        signatoryEmail: 'cto@acme.example',
      } as any),
    ).toThrow(DpaValidationError);
    expect(() =>
      validateAccept({
        signatoryName: 'A',
        signatoryTitle: 'CTO',
        signatoryEmail: 'not an email',
      } as any),
    ).toThrow(DpaValidationError);
  });

  it('rejects an unknown version id', () => {
    expect(() =>
      validateAccept({
        versionId: 'not-a-version',
        signatoryName: 'A',
        signatoryTitle: 'CTO',
        signatoryEmail: 'cto@acme.example',
      }),
    ).toThrow(DpaValidationError);
  });

  it('defaults to the current version when none specified', () => {
    const v = validateAccept({
      signatoryName: 'A',
      signatoryTitle: 'CTO',
      signatoryEmail: 'cto@acme.example',
    });
    expect(v.versionId).toBe(currentVersion().id);
  });
});

describe('dpa acceptance record + verify', () => {
  it('records an acceptance, persists it, and verifies its signature', async () => {
    const a = await recordAcceptance(
      dir,
      {
        signatoryName: 'Alice Example',
        signatoryTitle: 'CTO',
        signatoryEmail: 'alice@acme.example',
      },
      { acceptedByUserId: 'user_owner', acceptedFromIp: '203.0.113.7' },
    );
    expect(a.id).toMatch(/^dpa_/);
    expect(a.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(a.versionFingerprint).toBe(currentVersion().fingerprint);
    expect(a.acceptedFromIp).toBe('203.0.113.7');

    const reloaded = await listAcceptances(dir);
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]!.id).toBe(a.id);

    const cur = await currentAcceptance(dir);
    expect(cur?.id).toBe(a.id);

    expect(await verifySignature(dir, a)).toBe(true);
  });

  it('fails verification if the persisted signature is tampered', async () => {
    const a = await recordAcceptance(
      dir,
      {
        signatoryName: 'Alice',
        signatoryTitle: 'CTO',
        signatoryEmail: 'alice@acme.example',
      },
      { acceptedByUserId: 'u', acceptedFromIp: '127.0.0.1' },
    );
    // Flip one bit of the signature.
    const tampered = {
      ...a,
      signature: a.signature.slice(0, -1) + (a.signature.endsWith('0') ? '1' : '0'),
    };
    expect(await verifySignature(dir, tampered)).toBe(false);
  });

  it('fails verification if the signatory email is altered post-hoc', async () => {
    const a = await recordAcceptance(
      dir,
      {
        signatoryName: 'Alice',
        signatoryTitle: 'CTO',
        signatoryEmail: 'alice@acme.example',
      },
      { acceptedByUserId: 'u', acceptedFromIp: '127.0.0.1' },
    );
    // Simulate someone editing the persisted JSON file to swap the
    // signatory email after the fact. The signature must reject it.
    const file = join(dir, 'dpa-acceptances.json');
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    raw.acceptances[0].signatoryEmail = 'attacker@evil.example';
    writeFileSync(file, JSON.stringify(raw));
    const reloaded = (await listAcceptances(dir))[0]!;
    expect(await verifySignature(dir, reloaded)).toBe(false);
  });
});
