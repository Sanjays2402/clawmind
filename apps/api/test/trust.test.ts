import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getProfile,
  updateProfile,
  publicView,
  renderSecurityTxt,
  TrustValidationError,
  validateAndMerge,
} from '../src/services/trust.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-trust-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('trust profile validation', () => {
  it('rejects malformed contact email', async () => {
    await expect(
      updateProfile(dir, 'u', { securityContactEmail: 'not-an-email' }),
    ).rejects.toThrow(TrustValidationError);
  });

  it('rejects malformed vulnerability policy URL', async () => {
    await expect(
      updateProfile(dir, 'u', { vulnerabilityPolicyUrl: 'javascript:alert(1)' as unknown as string }),
    ).rejects.toThrow(TrustValidationError);
  });

  it('rejects framework with unknown status', () => {
    const base = {
      summary: '', securityContactEmail: null, vulnerabilityPolicyUrl: null,
      frameworks: [], encryptionAtRest: null, encryptionInTransit: null,
      dataResidency: null, links: [], updatedAt: 0, updatedBy: null,
    };
    expect(() =>
      validateAndMerge(base, {
        frameworks: [{ name: 'SOC 2', status: 'totally_legit' as never, issuedAt: null, auditor: null, reportUrl: null }],
      }),
    ).toThrow(TrustValidationError);
  });

  it('rejects link with non-http url', () => {
    const base = {
      summary: '', securityContactEmail: null, vulnerabilityPolicyUrl: null,
      frameworks: [], encryptionAtRest: null, encryptionInTransit: null,
      dataResidency: null, links: [], updatedAt: 0, updatedBy: null,
    };
    expect(() =>
      validateAndMerge(base, { links: [{ label: 'Bad', url: 'ftp://x.example' }] }),
    ).toThrow(TrustValidationError);
  });
});

describe('trust profile storage', () => {
  it('starts empty on a fresh install', async () => {
    const p = await getProfile(dir);
    expect(p.summary).toBe('');
    expect(p.frameworks).toEqual([]);
    expect(p.links).toEqual([]);
    expect(p.updatedBy).toBeNull();
  });

  it('persists an update and stamps updatedBy', async () => {
    const next = await updateProfile(dir, 'user_owner', {
      summary: 'We hold a SOC 2 Type II.',
      securityContactEmail: 'security@example.com',
      frameworks: [
        { name: 'SOC 2 Type II', status: 'achieved', issuedAt: '2025-01-15', auditor: 'Prescient', reportUrl: null },
      ],
      encryptionAtRest: 'AES-256 at the storage layer',
      encryptionInTransit: 'TLS 1.3 for every public endpoint',
      links: [{ label: 'Privacy Policy', url: 'https://example.com/privacy' }],
    });
    expect(next.updatedBy).toBe('user_owner');
    expect(next.frameworks).toHaveLength(1);
    expect(next.frameworks[0]!.status).toBe('achieved');

    const reloaded = await getProfile(dir);
    expect(reloaded.summary).toBe('We hold a SOC 2 Type II.');
    expect(reloaded.securityContactEmail).toBe('security@example.com');
    expect(reloaded.links[0]!.url).toBe('https://example.com/privacy');
  });

  it('public projection strips operator-only fields', async () => {
    await updateProfile(dir, 'user_owner', { summary: 'public summary' });
    const p = await getProfile(dir);
    const view = publicView(p) as Record<string, unknown>;
    expect(view.summary).toBe('public summary');
    expect(view.updatedBy).toBeUndefined();
    expect(typeof view.generatedAt).toBe('number');
  });
});

describe('security.txt rendering', () => {
  it('returns null when no contact is configured', async () => {
    const p = await getProfile(dir);
    expect(renderSecurityTxt(p)).toBeNull();
  });

  it('emits a Contact line and an Expires line when configured', async () => {
    await updateProfile(dir, 'u', {
      securityContactEmail: 'security@example.com',
      vulnerabilityPolicyUrl: 'https://example.com/vdp',
    });
    const p = await getProfile(dir);
    const txt = renderSecurityTxt(p)!;
    expect(txt).toMatch(/Contact: mailto:security@example.com/);
    expect(txt).toMatch(/Contact: https:\/\/example.com\/vdp/);
    expect(txt).toMatch(/Expires: \d{4}-\d{2}-\d{2}T/);
    expect(txt).toMatch(/Policy: https:\/\/example.com\/vdp/);
  });
});
