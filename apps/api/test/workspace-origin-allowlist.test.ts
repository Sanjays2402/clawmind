import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getRecord,
  replaceRecord,
  validate,
  originAllowedByWorkspace,
  diff,
  MAX_ORIGIN_RULES,
} from '../src/services/workspace-origin-allowlist.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-wsorigin-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('workspace-origin-allowlist service', () => {
  it('starts disabled with an empty rule set', async () => {
    const rec = await getRecord(dir);
    expect(rec.enabled).toBe(false);
    expect(rec.rules).toEqual([]);
  });

  it('rejects enabling with no rules to prevent meaningless config', () => {
    const v = validate({ enabled: true, rules: [] });
    expect(v.ok).toBe(false);
  });

  it('rejects an origin that carries a path or query', () => {
    const v = validate({ enabled: true, rules: [{ origin: 'https://app.acme.com/dashboard' }] });
    expect(v.ok).toBe(false);
  });

  it('rejects a non-http(s) scheme', () => {
    const v = validate({ enabled: true, rules: [{ origin: 'javascript:void(0)' }] });
    expect(v.ok).toBe(false);
  });

  it('rejects duplicate origins after normalisation', () => {
    const v = validate({
      enabled: true,
      rules: [
        { origin: 'https://app.acme.com' },
        { origin: 'https://APP.acme.com:443' },
      ],
    });
    expect(v.ok).toBe(false);
  });

  it('caps the rule count', () => {
    const rules = Array.from({ length: MAX_ORIGIN_RULES + 1 }, (_, i) => ({
      origin: `https://t${i}.acme.com`,
    }));
    const v = validate({ enabled: true, rules });
    expect(v.ok).toBe(false);
  });

  it('persists rules, normalises origin, and surfaces a diff', async () => {
    const next = await replaceRecord(dir, 'u-owner', {
      enabled: true,
      rules: [{ origin: 'HTTPS://APP.acme.com:443/', label: 'portal' }],
    });
    expect(next.rules[0].origin).toBe('https://app.acme.com');
    expect(next.enabled).toBe(true);
    expect(next.updatedBy).toBe('u-owner');

    const after = await replaceRecord(dir, 'u-owner', {
      enabled: true,
      rules: [
        { origin: 'https://app.acme.com', label: 'portal' },
        { origin: 'https://intranet.acme.com', label: 'intranet' },
      ],
    });
    const d = diff(next, after);
    expect(d.added).toEqual(['https://intranet.acme.com']);
    expect(d.removed).toEqual([]);
  });

  it('originAllowedByWorkspace returns false when disabled (handled by static baseline elsewhere)', async () => {
    const rec = await getRecord(dir);
    expect(originAllowedByWorkspace('https://anything.example', rec)).toBe(false);
  });

  it('originAllowedByWorkspace admits exactly the configured origins', async () => {
    const rec = await replaceRecord(dir, 'u-owner', {
      enabled: true,
      rules: [{ origin: 'https://app.acme.com' }],
    });
    expect(originAllowedByWorkspace('https://app.acme.com', rec)).toBe(true);
    expect(originAllowedByWorkspace('https://app.acme.com:443', rec)).toBe(true);
    expect(originAllowedByWorkspace('https://evil.example', rec)).toBe(false);
    expect(originAllowedByWorkspace(null, rec)).toBe(false);
    expect(originAllowedByWorkspace('not-a-url', rec)).toBe(false);
  });

  it('does not leak data between two workspace data directories', async () => {
    const other = mkdtempSync(join(tmpdir(), 'cm-wsorigin-other-'));
    try {
      await replaceRecord(dir, 'u-owner-a', {
        enabled: true,
        rules: [{ origin: 'https://a.example' }],
      });
      const b = await getRecord(other);
      expect(b.enabled).toBe(false);
      expect(b.rules).toEqual([]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
