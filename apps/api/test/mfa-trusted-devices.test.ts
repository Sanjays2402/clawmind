import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  mintDevice,
  verifyCookie,
  revokeDevice,
  revokeAll,
  listDevices,
  loadDevices,
  hashToken,
  MAX_TRUST_DAYS,
  MAX_DEVICES_PER_USER,
} from '../src/services/mfa-trusted-devices.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-mfa-td-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605 Chrome/126';

describe('mfa-trusted-devices', () => {
  it('mints a cookie that verifies for the same user only', async () => {
    const m = await mintDevice(dir, 'alice', { ip: '1.2.3.4', userAgent: ua });
    const ok = await verifyCookie(dir, m.cookieValue);
    expect(ok).not.toBeNull();
    expect(ok!.userId).toBe('alice');
    expect(ok!.device.id).toBe(m.id);
    // Same raw token presented under a different userId prefix must not match.
    const dot = m.cookieValue.indexOf('.');
    const raw = m.cookieValue.slice(dot + 1);
    const wrong = await verifyCookie(dir, `bob.${raw}`);
    expect(wrong).toBeNull();
  });

  it('stores only the hash on disk, never the raw token', async () => {
    const m = await mintDevice(dir, 'alice', { ip: '1.2.3.4', userAgent: ua });
    const file = join(dir, 'mfa', 'trusted', 'alice.json');
    const raw = m.cookieValue.slice(m.cookieValue.indexOf('.') + 1);
    const onDisk = readFileSync(file, 'utf8');
    expect(onDisk).not.toContain(raw);
    expect(onDisk).toContain(hashToken(raw));
  });

  it('rejects a tampered token', async () => {
    const m = await mintDevice(dir, 'alice', { ip: '1.2.3.4', userAgent: ua });
    const tampered = m.cookieValue.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    const v = await verifyCookie(dir, tampered);
    expect(v).toBeNull();
  });

  it('prunes expired entries on verify', async () => {
    const m = await mintDevice(dir, 'alice', { ip: '1.2.3.4', userAgent: ua, trustDays: 1 });
    // Force-expire by rewriting expiresAt.
    const devices = await loadDevices(dir, 'alice');
    devices[0]!.expiresAt = Date.now() - 1000;
    // Use the public save path by adding another fresh device through mint to overwrite the file.
    const m2 = await mintDevice(dir, 'alice', { ip: '1.2.3.4', userAgent: ua });
    // Manually overwrite to simulate the expired one persisted.
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      join(dir, 'mfa', 'trusted', 'alice.json'),
      JSON.stringify(
        {
          version: 1,
          userId: 'alice',
          devices: [
            { ...devices[0]!, expiresAt: Date.now() - 1000 },
            (await loadDevices(dir, 'alice')).find((d) => d.id === m2.id)!,
          ],
        },
        null,
        2,
      ),
    );
    const v = await verifyCookie(dir, m.cookieValue);
    expect(v).toBeNull();
    const remaining = await listDevices(dir, 'alice');
    expect(remaining.find((d) => d.id === m.id)).toBeUndefined();
    expect(remaining.find((d) => d.id === m2.id)).toBeDefined();
  });

  it('clamps trustDays to the allowed range', async () => {
    const m = await mintDevice(dir, 'alice', { ip: '1.1.1.1', userAgent: ua, trustDays: 999 });
    const expectedMax = Date.now() + MAX_TRUST_DAYS * 86400_000 + 1000;
    expect(m.record.expiresAt).toBeLessThan(expectedMax);
    expect(m.record.expiresAt).toBeGreaterThan(Date.now() + (MAX_TRUST_DAYS - 1) * 86400_000);
  });

  it('caps per-user device count', async () => {
    for (let i = 0; i < MAX_DEVICES_PER_USER + 5; i++) {
      await mintDevice(dir, 'alice', { ip: '9.9.9.9', userAgent: `${ua}#${i}` });
    }
    const list = await listDevices(dir, 'alice');
    expect(list.length).toBe(MAX_DEVICES_PER_USER);
  });

  it('revokes a single device', async () => {
    const m1 = await mintDevice(dir, 'alice', { ip: '1.1.1.1', userAgent: ua });
    const m2 = await mintDevice(dir, 'alice', { ip: '2.2.2.2', userAgent: ua });
    const removed = await revokeDevice(dir, 'alice', m1.id);
    expect(removed?.id).toBe(m1.id);
    expect(await verifyCookie(dir, m1.cookieValue)).toBeNull();
    expect((await verifyCookie(dir, m2.cookieValue))?.device.id).toBe(m2.id);
  });

  it('revokes everything in one call', async () => {
    const m1 = await mintDevice(dir, 'alice', { ip: '1.1.1.1', userAgent: ua });
    await mintDevice(dir, 'alice', { ip: '2.2.2.2', userAgent: ua });
    const n = await revokeAll(dir, 'alice');
    expect(n).toBe(2);
    expect(await listDevices(dir, 'alice')).toEqual([]);
    expect(await verifyCookie(dir, m1.cookieValue)).toBeNull();
  });

  it('keeps users isolated: bob cannot see or use alice cookies', async () => {
    const ma = await mintDevice(dir, 'alice', { ip: '1.1.1.1', userAgent: ua });
    const mb = await mintDevice(dir, 'bob', { ip: '2.2.2.2', userAgent: ua });
    const aliceList = await listDevices(dir, 'alice');
    const bobList = await listDevices(dir, 'bob');
    expect(aliceList.map((d) => d.id)).toEqual([ma.id]);
    expect(bobList.map((d) => d.id)).toEqual([mb.id]);
    // bob's cookie must not validate as alice and vice versa.
    expect((await verifyCookie(dir, mb.cookieValue))?.userId).toBe('bob');
    expect((await verifyCookie(dir, ma.cookieValue))?.userId).toBe('alice');
  });
});
