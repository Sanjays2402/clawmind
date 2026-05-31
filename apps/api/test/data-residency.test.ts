import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KNOWN_REGIONS,
  ResidencyValidationError,
  currentServerRegion,
  evaluate,
  getPolicy,
  invalidateCache,
  isKnownRegion,
  setPolicy,
} from '../src/services/data-residency.js';

let dir: string;
const origRegion = process.env.CLAWMIND_REGION;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-data-residency-'));
  invalidateCache();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (origRegion === undefined) delete process.env.CLAWMIND_REGION;
  else process.env.CLAWMIND_REGION = origRegion;
});

describe('data-residency service', () => {
  it('defaults to unrestricted on a fresh deployment', async () => {
    const p = await getPolicy(dir);
    expect(p.allowedRegions).toEqual([]);
    expect(p.controller).toBe('');
    expect(p.updatedBy).toBeNull();
  });

  it('setPolicy normalises, dedupes, sorts to KNOWN_REGIONS order, and records actor', async () => {
    const p = await setPolicy(dir, 'owner-1', {
      allowedRegions: ['EU', 'us', 'eu', 'UK'],
      controller: '  Acme GmbH  ',
    });
    expect(p.updatedBy).toBe('owner-1');
    expect(p.controller).toBe('Acme GmbH');
    expect(p.allowedRegions).toEqual(['us', 'eu', 'uk']);
  });

  it('rejects unknown regions with a structured error', async () => {
    await expect(
      setPolicy(dir, 'owner-1', { allowedRegions: ['mars'] }),
    ).rejects.toBeInstanceOf(ResidencyValidationError);
  });

  it('rejects non-array allowedRegions and non-string controller', async () => {
    await expect(
      // @ts-expect-error intentional type violation
      setPolicy(dir, 'owner-1', { allowedRegions: 'us' }),
    ).rejects.toBeInstanceOf(ResidencyValidationError);
    await expect(
      // @ts-expect-error intentional type violation
      setPolicy(dir, 'owner-1', { controller: 42 }),
    ).rejects.toBeInstanceOf(ResidencyValidationError);
  });

  it('rejects controller strings longer than 200 characters', async () => {
    await expect(
      setPolicy(dir, 'owner-1', { controller: 'x'.repeat(201) }),
    ).rejects.toBeInstanceOf(ResidencyValidationError);
  });

  it('evaluate returns ok when policy is unrestricted', () => {
    const r = evaluate(
      {
        workspaceId: 'default',
        allowedRegions: [],
        controller: '',
        updatedAt: 0,
        updatedBy: null,
      },
      'us',
    );
    expect(r.ok).toBe(true);
  });

  it('evaluate allows mutations only when server region is in the allow-list', () => {
    const policy = {
      workspaceId: 'default',
      allowedRegions: ['eu', 'uk'] as ('eu' | 'uk')[],
      controller: '',
      updatedAt: 0,
      updatedBy: null,
    };
    const allowed = evaluate(policy as never, 'eu');
    expect(allowed.ok).toBe(true);
    const denied = evaluate(policy as never, 'us');
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.reason).toBe('region-not-allowed');
      expect(denied.serverRegion).toBe('us');
      expect(denied.allowedRegions).toEqual(['eu', 'uk']);
    }
  });

  it('currentServerRegion respects CLAWMIND_REGION and falls back to us', () => {
    process.env.CLAWMIND_REGION = 'eu';
    expect(currentServerRegion()).toBe('eu');
    process.env.CLAWMIND_REGION = '  UK  ';
    expect(currentServerRegion()).toBe('uk');
    process.env.CLAWMIND_REGION = 'mars';
    expect(currentServerRegion()).toBe('us');
    delete process.env.CLAWMIND_REGION;
    expect(currentServerRegion()).toBe('us');
  });

  it('isKnownRegion matches the KNOWN_REGIONS set', () => {
    for (const r of KNOWN_REGIONS) expect(isKnownRegion(r)).toBe(true);
    expect(isKnownRegion('US')).toBe(false);
    expect(isKnownRegion('')).toBe(false);
  });

  it('round-trips through disk', async () => {
    await setPolicy(dir, 'owner-1', {
      allowedRegions: ['eu'],
      controller: 'Acme GmbH',
    });
    const p = await getPolicy(dir);
    expect(p.allowedRegions).toEqual(['eu']);
    expect(p.controller).toBe('Acme GmbH');
    expect(p.updatedBy).toBe('owner-1');
  });
});
