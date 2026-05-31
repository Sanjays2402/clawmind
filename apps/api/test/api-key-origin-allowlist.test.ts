import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  issueKey,
  setKeyAllowedOrigins,
  normaliseKeyOriginRules,
  normaliseOrigin,
  originAllowedByKey,
  loadKeys,
  MAX_KEY_ORIGIN_RULES,
} from '../src/services/api-keys.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-key-origin-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('api-key per-key Origin allowlist', () => {
  it('normalises scheme/host/port and strips defaults', () => {
    expect(normaliseOrigin('https://App.Example.com')).toBe('https://app.example.com');
    expect(normaliseOrigin('https://app.example.com:443')).toBe('https://app.example.com');
    expect(normaliseOrigin('http://app.example.com:80')).toBe('http://app.example.com');
    expect(normaliseOrigin('https://app.example.com:8443')).toBe('https://app.example.com:8443');
  });

  it('rejects non-http schemes, paths, credentials, and junk', () => {
    expect(normaliseOrigin('ftp://app.example.com')).toBeNull();
    expect(normaliseOrigin('javascript:alert(1)')).toBeNull();
    expect(normaliseOrigin('https://app.example.com/path')).toBeNull();
    expect(normaliseOrigin('https://user:pw@app.example.com')).toBeNull();
    expect(normaliseOrigin('https://app.example.com?q=1')).toBeNull();
    expect(normaliseOrigin('not a url')).toBeNull();
    expect(normaliseOrigin('')).toBeNull();
  });

  it('rule-list normaliser dedupes, validates, and bounds size', () => {
    const ok = normaliseKeyOriginRules(['https://a.example.com', 'https://A.example.com']);
    expect(ok.ok).toBe(false); // duplicate after normalise
    expect(normaliseKeyOriginRules(null).ok).toBe(true);
    expect(normaliseKeyOriginRules([]).rules).toEqual([]);
    expect(normaliseKeyOriginRules(['https://a.example.com']).rules).toEqual(['https://a.example.com']);
    expect(normaliseKeyOriginRules(['nope']).ok).toBe(false);
    expect(
      normaliseKeyOriginRules(new Array(MAX_KEY_ORIGIN_RULES + 1).fill('https://a.example.com')).ok,
    ).toBe(false);
  });

  it('unrestricted key accepts any origin (or none)', () => {
    expect(originAllowedByKey('https://anywhere.example', null)).toBe(true);
    expect(originAllowedByKey(undefined, [])).toBe(true);
    expect(originAllowedByKey(null, null)).toBe(true);
  });

  it('restricts browser callers but leaves server-to-server alone', () => {
    const rules = ['https://app.example.com', 'https://admin.example.com:8443'];
    // Browser request from an allowed origin: pass.
    expect(originAllowedByKey('https://app.example.com', rules)).toBe(true);
    // Same allowed host but explicit default port: pass after normalise.
    expect(originAllowedByKey('https://app.example.com:443', rules)).toBe(true);
    // Non-default port matched exactly: pass.
    expect(originAllowedByKey('https://admin.example.com:8443', rules)).toBe(true);
    // Browser request from a foreign origin: deny.
    expect(originAllowedByKey('https://evil.example.com', rules)).toBe(false);
    // Subdomain not in the list: deny (no implicit wildcards).
    expect(originAllowedByKey('https://other.app.example.com', rules)).toBe(false);
    // Scheme mismatch: deny.
    expect(originAllowedByKey('http://app.example.com', rules)).toBe(false);
    // Malformed Origin against a configured list: deny (fail closed).
    expect(originAllowedByKey('not-a-url', rules)).toBe(false);
    // Server-to-server caller omits Origin: pass even when a list is set,
    // because there is no browser to enforce against.
    expect(originAllowedByKey(undefined, rules)).toBe(true);
    expect(originAllowedByKey(null, rules)).toBe(true);
    expect(originAllowedByKey('', rules)).toBe(true);
  });

  it('setKeyAllowedOrigins persists, clears with null, and refuses cross-owner edits', async () => {
    const issued = await issueKey(dir, { userId: 'u1', label: 'browser' });
    const updated = await setKeyAllowedOrigins(dir, 'u1', issued.record.id, ['https://app.example.com']);
    expect(updated?.allowedOrigins).toEqual(['https://app.example.com']);
    const persisted = await loadKeys(dir);
    expect(persisted[0]!.allowedOrigins).toEqual(['https://app.example.com']);

    const cleared = await setKeyAllowedOrigins(dir, 'u1', issued.record.id, null);
    expect(cleared?.allowedOrigins).toBeNull();

    const stranger = await setKeyAllowedOrigins(dir, 'u2', issued.record.id, ['https://app.example.com']);
    expect(stranger).toBeNull();

    await expect(
      setKeyAllowedOrigins(dir, 'u1', issued.record.id, ['javascript:alert(1)']),
    ).rejects.toThrow();
  });
});
