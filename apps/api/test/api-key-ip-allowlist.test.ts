import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  issueKey,
  setKeyAllowedIps,
  normaliseKeyIpRules,
  ipAllowedByKey,
  loadKeys,
  MAX_KEY_IP_RULES,
} from '../src/services/api-keys.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-key-ip-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('api-key per-key IP allowlist', () => {
  it('normalises bare IPs and CIDR blocks and rejects junk', () => {
    expect(normaliseKeyIpRules(['203.0.113.7']).rules).toEqual(['203.0.113.7']);
    expect(normaliseKeyIpRules(['10.0.0.0/8']).rules).toEqual(['10.0.0.0/8']);
    expect(normaliseKeyIpRules(null).ok).toBe(true);
    expect(normaliseKeyIpRules([]).rules).toEqual([]);
    const bad = normaliseKeyIpRules(['not-an-ip']);
    expect(bad.ok).toBe(false);
    expect(bad.index).toBe(0);
    const dup = normaliseKeyIpRules(['10.0.0.0/8', '10.0.0.0/8']);
    expect(dup.ok).toBe(false);
    expect(normaliseKeyIpRules(new Array(MAX_KEY_IP_RULES + 1).fill('10.0.0.0/8')).ok).toBe(false);
  });

  it('unrestricted key accepts any source IP', () => {
    expect(ipAllowedByKey('1.2.3.4', null)).toBe(true);
    expect(ipAllowedByKey('1.2.3.4', [])).toBe(true);
    expect(ipAllowedByKey(undefined, null)).toBe(true);
  });

  it('restricts to the configured CIDR and rejects everything else', () => {
    const rules = ['10.0.0.0/8', '203.0.113.7/32'];
    expect(ipAllowedByKey('10.5.4.3', rules)).toBe(true);
    expect(ipAllowedByKey('203.0.113.7', rules)).toBe(true);
    expect(ipAllowedByKey('203.0.113.8', rules)).toBe(false);
    expect(ipAllowedByKey('8.8.8.8', rules)).toBe(false);
    // Restrictive list with no source IP must fail closed.
    expect(ipAllowedByKey(undefined, rules)).toBe(false);
    expect(ipAllowedByKey(null, rules)).toBe(false);
  });

  it('handles IPv6 in CIDR form', () => {
    const rules = ['2001:db8::/32'];
    expect(ipAllowedByKey('2001:db8::1', rules)).toBe(true);
    expect(ipAllowedByKey('2001:dead::1', rules)).toBe(false);
  });

  it('setKeyAllowedIps persists the normalised list and clears with null', async () => {
    const issued = await issueKey(dir, { userId: 'u1', label: 'cli' });
    const updated = await setKeyAllowedIps(dir, 'u1', issued.record.id, ['10.0.0.0/8']);
    expect(updated?.allowedIps).toEqual(['10.0.0.0/8']);
    const all = await loadKeys(dir);
    expect(all[0]!.allowedIps).toEqual(['10.0.0.0/8']);
    const cleared = await setKeyAllowedIps(dir, 'u1', issued.record.id, null);
    expect(cleared?.allowedIps).toBeNull();
  });

  it('refuses to update a key owned by another user', async () => {
    const issued = await issueKey(dir, { userId: 'u1', label: 'cli' });
    const updated = await setKeyAllowedIps(dir, 'u2', issued.record.id, ['10.0.0.0/8']);
    expect(updated).toBeNull();
  });

  it('throws on invalid input so routes can return 400', async () => {
    const issued = await issueKey(dir, { userId: 'u1', label: 'cli' });
    await expect(setKeyAllowedIps(dir, 'u1', issued.record.id, ['nope'])).rejects.toThrow();
  });
});
